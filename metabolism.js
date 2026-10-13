// Energy needs. Resting energy uses the Mifflin-St Jeor equation (Mifflin et al., Am J Clin
// Nutr 1990), which the Academy of Nutrition and Dietetics review (Frankenfield et al., 2005)
// found the most accurate of the common equations. Revised Harris-Benedict (Roza & Shizgal,
// 1984) and Katch-McArdle (when body fat is known) are shown alongside as a range.

export const ACTIVITY = [
  { id: 'sedentary', factor: 1.2, label: 'Sedentary', hint: 'Desk work, little or no exercise' },
  { id: 'light', factor: 1.375, label: 'Lightly active', hint: 'Light exercise 1–3 days a week' },
  { id: 'moderate', factor: 1.55, label: 'Moderately active', hint: 'Moderate exercise 3–5 days a week' },
  { id: 'very', factor: 1.725, label: 'Very active', hint: 'Hard exercise 6–7 days a week' },
  { id: 'extra', factor: 1.9, label: 'Extremely active', hint: 'Physical job plus daily training' },
];

// About 7,700 kcal per kg of body weight change, spread over 7 days.
export const GOALS = [
  { id: 'maintain', delta: 0, label: 'Maintain weight' },
  { id: 'lose-0.25', delta: -275, label: 'Lose 0.25 kg (½ lb) a week' },
  { id: 'lose-0.5', delta: -550, label: 'Lose 0.5 kg (1 lb) a week' },
  { id: 'gain-0.25', delta: 275, label: 'Gain 0.25 kg (½ lb) a week' },
];

// Acceptable Macronutrient Distribution Ranges, % of energy (Institute of Medicine DRI, 2005).
export const AMDR = {
  protein: { min: 0.10, max: 0.35, kcalPerG: 4 },
  carb: { min: 0.45, max: 0.65, kcalPerG: 4 },
  fat: { min: 0.20, max: 0.35, kcalPerG: 9 },
};

export const LB_PER_KG = 2.20462;
export const CM_PER_IN = 2.54;

export function validateProfile(raw) {
  const errors = {};
  const num = v => (v === '' || v == null ? NaN : Number(v));
  const age = num(raw.age), heightCm = num(raw.heightCm), weightKg = num(raw.weightKg);
  const bodyFat = raw.bodyFat === '' || raw.bodyFat == null ? null : num(raw.bodyFat);
  if (raw.sex !== 'male' && raw.sex !== 'female') errors.sex = 'Choose the sex the equations should use.';
  if (!(age >= 18 && age <= 100)) errors.age = 'Enter an age from 18 to 100. These equations are validated for adults.';
  if (!(heightCm >= 120 && heightCm <= 230)) errors.height = 'Enter a height between 120 and 230 cm (3′11″–7′6″).';
  if (!(weightKg >= 30 && weightKg <= 300)) errors.weight = 'Enter a weight between 30 and 300 kg (66–660 lb).';
  if (bodyFat !== null && !(bodyFat >= 3 && bodyFat <= 60)) errors.bodyFat = 'Body fat should be between 3% and 60%, or left blank.';
  if (!ACTIVITY.some(a => a.id === raw.activity)) errors.activity = 'Choose an activity level.';
  const goal = GOALS.some(g => g.id === raw.goal) ? raw.goal : 'maintain';
  const units = raw.units === 'us' ? 'us' : 'metric';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, profile: { sex: raw.sex, age, heightCm, weightKg, bodyFat, activity: raw.activity, goal, units } };
}

export function estimate(p) {
  const { sex, age: a, heightCm: h, weightKg: w, bodyFat } = p;
  const male = sex === 'male';
  const act = ACTIVITY.find(x => x.id === p.activity) || ACTIVITY[0];
  const goal = GOALS.find(g => g.id === p.goal) || GOALS[0];
  const msj = 10 * w + 6.25 * h - 5 * a + (male ? 5 : -161);
  const hb = male ? 88.362 + 13.397 * w + 4.799 * h - 5.677 * a : 447.593 + 9.247 * w + 3.098 * h - 4.330 * a;
  const equations = [
    { name: 'Mifflin-St Jeor', bmr: msj, primary: true },
    { name: 'Revised Harris-Benedict', bmr: hb },
  ];
  if (bodyFat != null) equations.push({ name: 'Katch-McArdle', bmr: 370 + 21.6 * w * (1 - bodyFat / 100) });
  equations.forEach(e => { e.tdee = e.bmr * act.factor; });
  const tdees = equations.map(e => e.tdee);
  const maintenance = msj * act.factor;
  // Targets below ~1,200 kcal (women) / 1,500 kcal (men) are generally not advised without supervision.
  const floor = male ? 1500 : 1200;
  const target = Math.max(maintenance + goal.delta, goal.delta < 0 ? floor : 0);
  return {
    bmr: msj, factor: act.factor, activity: act, goal, maintenance, target,
    floored: goal.delta < 0 && maintenance + goal.delta < floor,
    equations, low: Math.min(...tdees), high: Math.max(...tdees),
    proteinRda: 0.8 * w,
  };
}

// Gram ranges for each macronutrient at a given calorie level.
export function macroRanges(kcal) {
  const out = {};
  for (const [k, r] of Object.entries(AMDR)) out[k] = { min: kcal * r.min / r.kcalPerG, max: kcal * r.max / r.kcalPerG };
  return out;
}
