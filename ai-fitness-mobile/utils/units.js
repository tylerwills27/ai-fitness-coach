// utils/units.js
export function cmToInches(cm) { return cm / 2.54; }
export function inchesToCm(inch) { return inch * 2.54; }
export function kgToLbs(kg) { return kg * 2.2046226218; }
export function lbsToKg(lb) { return lb / 2.2046226218; }

export function formatHeight(height_cm, units = "imperial") {
  if (units === "metric") return `${Math.round(height_cm)} cm`;
  const totalIn = Math.round(cmToInches(height_cm));
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn % 12;
  return `${ft}′${inch}″`;
}

export function formatWeight(weight_kg, units = "imperial") {
  if (units === "metric") return `${Math.round(weight_kg)} kg`;
  return `${Math.round(kgToLbs(weight_kg))} lb`;
}
