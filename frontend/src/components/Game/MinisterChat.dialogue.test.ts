import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { MinisterChat, type MinisterChatProps } from './MinisterChat';
import { ministerApi, type AdvisorHistoryItem } from '../../services/api';

// Node-only hook driver: run this component's effects and event handlers without a DOM.
const hooks = vi.hoisted(() => ({ index: 0, slots: [] as any[], effects: [] as (() => void)[] }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual,
    useState: (initial: unknown) => {
      const index = hooks.index++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value; }];
    },
    useRef: (initial: unknown) => {
      const index = hooks.index++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const index = hooks.index++;
      const previous = hooks.slots[index];
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      hooks.effects.push(() => { previous?.cleanup?.(); hooks.slots[index] = { deps, cleanup: effect() }; });
    },
  };
});

function render(props: MinisterChatProps): ReactElement {
  hooks.index = 0;
  const tree = MinisterChat(props);
  hooks.effects.splice(0).forEach(effect => effect());
  return tree;
}

function textarea(tree: ReactElement): ReactElement<any> {
  const children = Array.isArray(tree.props.children) ? tree.props.children : [tree.props.children];
  for (const child of children) {
    if (!child || typeof child !== 'object' || !('type' in child)) continue;
    if (child.type === 'textarea') return child;
    try { return textarea(child); } catch { /* search the remaining branches */ }
  }
  throw new Error('Textarea not found');
}

function props(): MinisterChatProps {
  const messages: AdvisorHistoryItem[] = [];
  return { gameId: 'game', sessionId: 'turn-1', address: { seat: 'tesoro', label: 'Tesoro', reads: 'Conti', opening: 'Fallback', items: [] }, messages, streaming: false,
    onAddMessage: message => messages.push(message),
    onAppendToken: token => { messages[messages.length - 1].content += token; },
    onStreamingChange: vi.fn(),
    currentDecision: { objective: 'Surplus', measures: [{ id: 'debt', label: 'Debt', kind: 'allocation', sharePct: 40, source: 'minister', status: 'proposed' }] },
    memory: [],
  };
}

async function send(current: MinisterChatProps, text: string): Promise<void> {
  textarea(render(current)).props.onChange({ target: { value: text } });
  textarea(render(current)).props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: vi.fn() });
  await Promise.resolve();
  render(current);
}

beforeEach(() => { hooks.index = 0; hooks.slots = []; hooks.effects = []; });
afterEach(() => {
  hooks.slots.forEach(slot => slot?.cleanup?.());
  vi.restoreAllMocks();
});

describe('MinisterChat opening continuity', () => {
  it('uses the actual opening on both sends, never regenerating it after local messages', async () => {
    const opening = 'Io non spenderei tutto.';
    const openingRequest = vi.spyOn(ministerApi, 'opening').mockResolvedValue({ reply: opening, seat: 'tesoro', narrativeOnly: true, persistMemory: false, allowDirectives: false });
    const stream = vi.spyOn(ministerApi, 'askStream').mockImplementation(async (_game, _seat, _message, _history, onToken) => { onToken('Proteggiamo la cassa.'); return 'Proteggiamo la cassa.'; });
    const current = props();
    render(current);
    await vi.waitFor(() => expect(openingRequest).toHaveBeenCalledTimes(1));
    await send(current, 'Perché?');
    current.address = { ...current.address!, opening: 'A different engine greeting.' };
    await send(current, 'E il resto?');
    expect(stream.mock.calls[0][3]).toEqual([{ role: 'assistant', content: opening }]);
    expect(stream.mock.calls[1][3]).toEqual([{ role: 'assistant', content: opening }, { role: 'user', content: 'Perché?' }, { role: 'assistant', content: 'Proteggiamo la cassa.' }]);
    expect(stream.mock.calls[1][7]).toEqual(current.currentDecision);
    expect(openingRequest).toHaveBeenCalledTimes(1);
    expect(current.messages.some(message => message.content === opening)).toBe(false);
    expect(current.memory).toEqual([]);
  });

  it.each(['session', 'seat'] as const)('does not inject an old opening after a %s reset while the new opening is pending', async reset => {
    const openingRequest = vi.spyOn(ministerApi, 'opening').mockResolvedValueOnce({ reply: 'Old greeting.', seat: 'tesoro', narrativeOnly: true, persistMemory: false, allowDirectives: false }).mockImplementation(() => new Promise(() => {}));
    const stream = vi.spyOn(ministerApi, 'askStream').mockResolvedValue('');
    const current = props();
    render(current);
    await vi.waitFor(() => expect(openingRequest).toHaveBeenCalledTimes(1));
    render(current);
    if (reset === 'session') current.sessionId = 'turn-2';
    else current.address = { ...current.address!, seat: 'lavori' };
    render(current);
    await send(current, 'Abbiamo margine?');
    expect(stream.mock.calls[0][3]).toEqual([]);
    expect(openingRequest).toHaveBeenCalledTimes(2);
  });
});
