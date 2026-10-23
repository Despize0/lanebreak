// Glicko-2 (Mark Glickman, http://www.glicko.net/glicko/glicko2.pdf).
// Each ranked match is treated as its own rating period with one game, which is the usual
// approach for online games. Rating deviation (RD) grows while a player is inactive.

const SCALE = 173.7178;
const TAU = 0.5; // how fast volatility can change; 0.3–1.2 is typical
const EPS = 1e-6;
export const DEFAULT_RATING = 1500;
export const DEFAULT_RD = 350;
export const DEFAULT_VOL = 0.06;
const MIN_RD = 45; // keep ratings a little responsive even for very active players

export interface Rating {
  rating: number;
  rd: number;
  vol: number;
}

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const E = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** RD after `days` without games (one rating period per day). */
export function decay(r: Rating, days: number): Rating {
  if (days <= 0) return r;
  const phi = r.rd / SCALE;
  const grown = Math.sqrt(phi * phi + r.vol * r.vol * days) * SCALE;
  return { ...r, rd: Math.min(DEFAULT_RD, grown) };
}

/**
 * Update `player` after one game against `opp`.
 * score: 1 = win, 0.5 = draw, 0 = loss.
 */
export function rate(player: Rating, opp: Rating, score: number): Rating {
  const mu = (player.rating - DEFAULT_RATING) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.vol;
  const muJ = (opp.rating - DEFAULT_RATING) / SCALE;
  const phiJ = opp.rd / SCALE;

  const gJ = g(phiJ);
  const e = E(mu, muJ, phiJ);
  const v = 1 / (gJ * gJ * e * (1 - e));
  const delta = v * gJ * (score - e);

  // new volatility (Illinois algorithm, step 5 of the paper)
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const d = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > EPS; i++) {
    const Cc = A + ((A - B) * fA) / (fB - fA);
    const fC = f(Cc);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = Cc;
    fB = fC;
  }
  const newSigma = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * gJ * (score - e);

  return {
    rating: newMu * SCALE + DEFAULT_RATING,
    rd: Math.max(MIN_RD, Math.min(DEFAULT_RD, newPhi * SCALE)),
    vol: newSigma,
  };
}

/** Expected score of a vs b (0..1), used for matchmaking fairness. */
export function expected(a: Rating, b: Rating): number {
  const mu = (a.rating - DEFAULT_RATING) / SCALE;
  const muJ = (b.rating - DEFAULT_RATING) / SCALE;
  const phiCombined = Math.sqrt((a.rd / SCALE) ** 2 + (b.rd / SCALE) ** 2);
  return E(mu, muJ, phiCombined);
}
