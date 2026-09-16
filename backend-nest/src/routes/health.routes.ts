/**
 * World Story — Health Routes
 * ========================
 */

import { Router } from 'express';
import { buildInfo } from '../health/build-info';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  // Q02 µ3: build/versione senza segreti (token, chiavi LLM, percorsi).
  res.json(buildInfo());
});
