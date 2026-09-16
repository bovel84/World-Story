/**
 * World Story — Games router
 * ========================
 * Router sottile: registra i controller di gioco per concern (Fase 5).
 * La logica dei handler vive in `./games/*.routes.ts` e `./games/helpers.ts`.
 */
import { Router } from 'express';
import { registerStateRoutes } from './games/state.routes';
import { registerAdvisorRoutes } from './games/advisor.routes';
import { registerSaveRoutes } from './games/save.routes';
import { registerEconomyRoutes } from './games/economy.routes';
import { registerActionsRoutes } from './games/actions.routes';
import { registerSimulationRoutes } from './games/simulations.routes';
import { registerPlaybackRoutes } from './games/playback.routes';

export const gamesRouter = Router();

registerStateRoutes(gamesRouter);
registerAdvisorRoutes(gamesRouter);
registerSaveRoutes(gamesRouter);
registerEconomyRoutes(gamesRouter);
registerActionsRoutes(gamesRouter);
registerSimulationRoutes(gamesRouter);
registerPlaybackRoutes(gamesRouter);
