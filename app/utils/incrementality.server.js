// Merchant-facing incrementality (build plan phase 6b).
//
// The dashboard's recovered-revenue number is engagement-attributed GROSS
// revenue: any order that touched the modal counts in full, including
// customers who would have bought anyway. The 5% sticky holdout gives the
// counterfactual: shown-CVR vs holdout-CVR. This helper turns that into a
// lift factor the UI can multiply against gross revenue for an HONEST
// "incremental revenue" estimate — and refuses to report anything until the
// holdout sample is big enough to mean something.
//
// Zero-invented-numbers rule: everything here is the shop's own measured
// data; below the sample gate the UI shows "measuring", never a projection.

export const MIN_HOLDOUT_FOR_LIFT = 30;

export async function getIncrementality(db, shopId) {
  const [shown, shownConverted, holdout, holdoutConverted] = await Promise.all([
    db.interventionOutcome.count({ where: { shopId, wasShown: true, isHoldout: false } }),
    db.interventionOutcome.count({ where: { shopId, wasShown: true, isHoldout: false, converted: true } }),
    db.interventionOutcome.count({ where: { shopId, isHoldout: true } }),
    db.interventionOutcome.count({ where: { shopId, isHoldout: true, converted: true } })
  ]);

  const shownCVR = shown > 0 ? shownConverted / shown : 0;
  const holdoutCVR = holdout > 0 ? holdoutConverted / holdout : 0;
  const measured = holdout >= MIN_HOLDOUT_FOR_LIFT && shown > 0;

  // Share of engaged revenue that would NOT have happened without the modal.
  // Clamped at 0 — negative lift reads as "no measurable incremental effect"
  // on the merchant surface (the admin console shows the signed value).
  const liftFactor = measured && shownCVR > 0
    ? Math.max(0, (shownCVR - holdoutCVR) / shownCVR)
    : null;

  return {
    shown,
    shownConverted,
    holdout,
    holdoutConverted,
    shownCVR,
    holdoutCVR,
    liftFactor,
    liftPts: measured ? (shownCVR - holdoutCVR) * 100 : null,
    measured,
    minHoldout: MIN_HOLDOUT_FOR_LIFT
  };
}
