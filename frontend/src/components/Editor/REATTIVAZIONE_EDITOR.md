# Riattivazione editor mappe (temporaneo)

L'editor mappe e la creazione del mondo da mappa personalizzata sono
**temporaneamente disattivati**: il wiring è stato estratto da `App.tsx`
per tenere il composition root pulito. Qui è conservato **verbatim** il
codice originale (decommentato), pronto da ripristinare.

Per riattivare:

1. Reimportare i componenti in `App.tsx`:
   `MapEditor`/`EditorRegion`/`EditorObject` da `components/Editor` e
   `CreateWorld`/`WorldConfig` da `components/WorldBuilder/CreateWorld`.
2. Reimportare `mapApi` da `services/api`.
3. Reintrodurre lo stato `selectedMapForWorld`/`savedMaps` nello store UI.
4. Ripristinare gli handler e i `render*` qui sotto e le rotte `editor`/`create-world`.

## 1. Helper `pointsToPath` (già presente in `Editor/index.ts` — verificare)

```ts
// DISATTIVATO: editor mappe (temporaneo) — helper punti nel path SVG usato solo
al salvataggio mappe dall’editor (handleSaveMapLocal/handleSaveMap)
// Funzione di supporto: punti nel path SVG
const pointsToPath = (points: { x: number; y: number }[]): string => {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
};
```

## 2. Caricamento mappe salvate + salvataggio/creazione mondo

```tsx
  // DISATTIVATO: editor mappe (temporaneo) — caricamento mappe salvate per «Le mie mappe»/editor
  useEffect(() => {
    const loadMaps = async () => {
      const maps: LocalMap[] = [];
  
      try {
        const serverMaps = await mapApi.list();
        for (const m of serverMaps) {
          try {
            const fullMap = await mapApi.get(m.id);
            maps.push({
              id: `server_${m.id}`,
              name: fullMap.name,
              regions: fullMap.regions.map(r => ({
                id: r.id,
                name: r.name,
                color: r.color,
                path: r.path,
              })),
            });
          } catch (e) { /* skip */ }
        }
      } catch (e) { /* skip */ }
  
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('map_')) {
          try {
            const data = JSON.parse(localStorage.getItem(key) || '{}');
            if (!maps.find(m => m.name === data.name)) {
              maps.push({ id: key, ...data });
            }
          } catch (e) { /* skip */ }
        }
      }
  
      setSavedMaps(maps);
    };
  
    loadMaps();
  }, [setSavedMaps]);

  // DISATTIVATO: editor mappe (temporaneo) — salvataggio mappe, scelta mappa e creazione mondo
  da mappa personalizzata (handleSaveMapLocal / handleSaveMap / handleSelectMap / handleCreateWorld)
  Salva la mappa localmente
  const handleSaveMapLocal = (regions: EditorRegion[], mapName: string, objects?: EditorObject[]): LocalMap => {
    const mapData: LocalMap = {
      id: `map_${Date.now()}`,
      name: mapName,
      regions: regions.map(r => ({
        id: r.id,
        name: r.name,
        color: r.color,
        path: pointsToPath(r.points),
      })),
      objects: objects?.map(o => ({
        id: o.id,
        type: o.type,
        name: o.name,
        x: o.x,
        y: o.y,
        regionId: o.regionId,
      })),
    };
    localStorage.setItem(mapData.id, JSON.stringify(mapData));
    addSavedMap(mapData);
    return mapData;
  };

  Salva la mappa sul server
  const handleSaveMap = async (regions: EditorRegion[], mapName: string, objects?: EditorObject[]) => {
    setLoading(true);
    const mapRegions = regions.map(r => ({
      id: r.id,
      name: r.name,
      color: r.color,
      path: pointsToPath(r.points),
    }));

    let serverMapId = null;
    try {
      const mapData = {
        name: mapName,
        width: 2000,
        height: 1500,
        regions: mapRegions,
        objects: objects?.map(o => ({
          id: o.id,
          type: o.type,
          name: o.name,
          x: o.x,
          y: o.y,
          regionId: o.regionId,
        })) || [],
      };
      const result = await mapApi.create(mapData);
      serverMapId = result.id;
      notify(`Mappa “${mapName}” salvata sul server.`, 'success');
    } catch (e) {
      console.warn('Failed to save map to server:', e);
    }

    const localMap = handleSaveMapLocal(regions, mapName, objects);
    if (serverMapId) {
      const updatedMap = { ...localMap, id: `server_${serverMapId}` };
      localStorage.removeItem(localMap.id);
      localStorage.setItem(updatedMap.id, JSON.stringify(updatedMap));
      setSavedMaps(prev => prev.filter(m => m.id !== localMap.id).concat(updatedMap));
    }

    setCurrentView('menu');
    setLoading(false);
  };

  Scegli la mappa per creare il mondo
  const handleSelectMap = (map: LocalMap) => {
    setSelectedMapForWorld(map);
    setCurrentView('create-world');
  };

  Crea il mondo dalla configurazione
  const handleCreateWorld = async (config: WorldConfig) => {
    setLoading(true);

    if (!selectedMapForWorld?.id.startsWith('server_')) {
      notify('Prima salva la mappa sul server (pulsante “Salva” nell’editor di mappe).', 'info');
      setLoading(false);
      return;
    }

    const mapId = selectedMapForWorld.id.replace('server_', '');

    const initialOwners = config.regions
      .filter(r => r.owner !== 'neutral')
      .map(r => ({ id: r.id, owner: r.owner }));

    try {
      const result = await worldApi.createFromMap({
        mapId,
        name: config.name,
        description: config.description,
        startDate: config.startDate,
        basePrompt: config.basePrompt,
        historicalAccuracy: config.historicalAccuracy / 100,
        initialOwners,
      });

      const world = await worldApi.get(result.world_id);
      const mapObjects = selectedMapForWorld?.objects || [];

      const regions: Region[] = Object.values(world.regions || {}).map((r: any) => {
        const regionObjects = mapObjects
          .filter((o: any) => o.regionId === r.id)
          .map((o: any) => ({
            id: o.id,
            type: o.type,
            name: o.name,
            x: o.x,
            y: o.y,
            level: 1,
            metadata: {},
          }));

        return {
          id: r.id,
          name: r.name,
          svgPath: r.svgPath,
          color: r.color,
          owner: r.owner || 'neutral',
          population: r.population || 1000000,
          gdp: r.gdp || 100,
          militaryPower: r.militaryPower || 100,
          objects: regionObjects,
          borders: r.borders || [],
          status: r.status || 'active',
          metadata: {},
        };
      });

      setCurrentWorld({
        ...world,
        regions: regions.reduce((acc: any, r) => { acc[r.id] = r; return acc; }, {}),
      } as World);

      const playerRegionInWorld = regions.find(r => r.owner === 'player');
      const initialPlayerRegionId = playerRegionInWorld?.id || regions[0]?.id || null;

      if (result.world_id && initialPlayerRegionId) {
        try {
          const gameResponse = await gameApi.create({
            world_id: result.world_id,
            player_name: 'Player',
            player_region_id: initialPlayerRegionId,
            difficulty,
          });
          const game = await gameApi.get(gameResponse.game_id);
          setCurrentGame(game);

          const playerRegionId = game.players[0]?.regionId || initialPlayerRegionId;
          setSelectedRegion(playerRegionId);
        } catch (e) {
          console.error('[DEBUG] Failed to create game via API:', e);
          setCurrentGame({
            id: 'local_' + Date.now(),
            world: { ...world, regions: regions.reduce((acc: any, r) => { acc[r.id] = r; return acc; }, {}) } as World,
            players: [{ id: 'player_1', name: 'Player', regionId: initialPlayerRegionId, color: '#ff0000' }],
            currentTurn: 1,
            maxTurns: 100,
            status: 'playing' as any,
          } as Game);
          setSelectedRegion(initialPlayerRegionId);
        }
      }

      setCurrentView('game');
    } catch (e) {
      console.error('[DEBUG] Failed to create world via API:', e);
      const mapObjects = selectedMapForWorld?.objects || [];
      const regions: Region[] = selectedMapForWorld?.regions.map(r => {
        const regionObjects = mapObjects
          .filter((o: any) => o.regionId === r.id)
          .map((o: any) => ({
            id: o.id,
            type: o.type,
            name: o.name,
            x: o.x,
            y: o.y,
            level: 1,
            metadata: {},
          }));

        return {
          id: r.id,
          name: r.name,
          svgPath: r.path,
          color: r.color,
          owner: 'neutral',
          population: 1000000,
          gdp: 100,
          militaryPower: 100,
          objects: regionObjects,
          borders: [],
          status: 'active' as any,
          metadata: {},
        };
      }) || [];

      const regionsWithOwner = regions.map(r => {
        const ownerConfig = config.regions.find(cr => cr.id === r.id);
        return {
          ...r,
          owner: ownerConfig?.owner || 'neutral',
        };
      });

      setCurrentWorld({
        id: selectedMapForWorld?.id || 'local',
        name: selectedMapForWorld?.name || 'Local World',
        description: 'Mappa locale',
        startDate: '1951-01-01',
        basePrompt: 'Storia alternativa',
        historicalAccuracy: 0.8,
        regions: regionsWithOwner.reduce((acc: any, r) => { acc[r.id] = r; return acc; }, {}),
        blocs: {},
      });

      const playerConfigRegion = config.regions.find(cr => cr.owner === 'player');
      const playerRegionId = playerConfigRegion?.id || regions[0]?.id || null;
      setSelectedRegion(playerRegionId);

      if (playerRegionId) {
        setCurrentGame({
          id: 'local_' + Date.now(),
          world: { ...currentWorld, regions: regionsWithOwner.reduce((acc: any, r) => { acc[r.id] = r; return acc; }, {}) },
          players: [{ id: 'player_1', name: 'Player', regionId: playerRegionId, color: '#ff0000' }],
          currentTurn: 1,
          maxTurns: 100,
          status: 'playing' as any,
        } as Game);
      }

      setCurrentView('game');
    }
    setLoading(false);
  };
```

## 3. Render dell'editor e della creazione mondo

```tsx
  // DISATTIVATO: editor mappe (temporaneo) — render dell’editor e della creazione mondo da mappa
  Render dell’editor
  const renderEditor = () => (
    <MapEditor
      onSave={handleSaveMap}
      onCancel={() => setCurrentView('menu')}
    />
  );

  const renderCreateWorld = () => {
    if (!selectedMapForWorld) {
      return (
        <div className="error-container">
          <p>Nessuna mappa selezionata</p>
          <button onClick={() => setCurrentView('menu')}>Torna al menu</button>
        </div>
      );
    }

    return (
      <CreateWorld
        mapId={selectedMapForWorld.id.startsWith('server_')
          ? selectedMapForWorld.id.replace('server_', '')
          : selectedMapForWorld.id.replace('map_', '')}
        mapName={selectedMapForWorld.name}
        regions={selectedMapForWorld.regions}
        onSave={handleCreateWorld}
        onCancel={() => {
          setSelectedMapForWorld(null);
          setCurrentView('menu');
        }}
      />
    );
  };
```
