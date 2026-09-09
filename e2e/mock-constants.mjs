/**
 * World Story — Costanti condivise per gli E2E mock (Q01 µ1)
 * ========================================================
 * Base URL dell'API del frontend. Il frontend usa `/api` (proxy vite verso il
 * backend) oppure `VITE_API_URL`. Negli E2E mock intercettiamo `/api/**` nel
 * browser, quindi il proxy vite non viene mai raggiunto.
 */
export const API_BASE = '**/api';
