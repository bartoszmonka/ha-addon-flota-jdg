/**
 * Tryb dodatku Home Assistanta (ingress).
 *
 * W kontenerze dodatku Supervisor ustawia SUPERVISOR_TOKEN. Wtedy:
 *  - dane samochodów czytamy przez proxy Supervisora (http://supervisor/core) tym tokenem – bez długoterminowego tokenu HA,
 *  - użytkownika rozpoznajemy po nagłówkach X-Remote-User-* dodawanych przez ingress (bez osobnego logowania),
 *  - nagłówki ufamy wyłącznie, gdy żądanie przyszło z bramki ingress (172.30.32.2).
 *
 * Ten plik musi być importowany jako pierwszy (ustawia zmienne środowiskowe dla auth.ts i ha.ts).
 */
import fs from 'node:fs';
import type express from 'express';
import type { SessionUser } from './auth.ts';

export const ADDON = Boolean(process.env.SUPERVISOR_TOKEN);

if (ADDON) {
  let options: { ha_vehicle_prefixes?: string } = {};
  try {
    options = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
  } catch {
    /* brak opcji – wartości domyślne */
  }
  process.env.HA_URL = 'http://supervisor/core';
  process.env.HA_TOKEN = process.env.SUPERVISOR_TOKEN;
  if (options.ha_vehicle_prefixes !== undefined) process.env.HA_VEHICLE_PREFIXES = options.ha_vehicle_prefixes;
}

const INGRESS_IPS = (process.env.INGRESS_IPS || '172.30.32.2').split(',').map((s) => s.trim());

/** Użytkownik HA z nagłówków ingress (tylko z zaufanego adresu bramki) */
export function ingressUser(req: express.Request): SessionUser | null {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!INGRESS_IPS.includes(ip)) return null;
  const uid = req.get('x-remote-user-id');
  if (!uid) return null;
  const name = req.get('x-remote-user-display-name') || req.get('x-remote-user-name') || uid;
  return { uid, name };
}
