'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Accuracy-evaluation benchmark dataset
//
// A labelled set of design statements used to MEASURE detection accuracy against
// the spec's §3g acceptance criteria ("Accuracy of detection > 95%, maximum false
// negatives <= 5%"). Each case is a binary compliance-detection task:
//
//   expectedIssue = true   → the statement violates/fails a class/IMO/IEC/naval
//                            requirement; a correct system MUST flag it. A miss
//                            here is a FALSE NEGATIVE (the ≤5% metric).
//   expectedIssue = false  → the statement is acceptable; flagging it would be a
//                            FALSE POSITIVE.
//
// The runner feeds each statement (with retrieved KB context) to the real
// pipeline and records the model's boolean verdict, so scoring is deterministic.
//
// This is a seed/starter set. Admins can extend it (data-driven cases can be
// added later); the harness computes the confusion matrix over whatever is here.
// ─────────────────────────────────────────────────────────────────────────────

const CASES = [
  // ── Non-compliant (expectedIssue: true) ────────────────────────────────────
  { id: 'E-01', category: 'Electrical', expectedIssue: true,
    statement: 'Final sub-circuits for lighting are protected only by an on/off switch, with no fuse or circuit breaker for overcurrent protection.',
    basis: 'Overcurrent (short-circuit/overload) protection is mandatory on final sub-circuits (IEC 60092-202 / class rules).' },
  { id: 'E-02', category: 'Electrical', expectedIssue: true,
    statement: 'Power and lighting cables throughout the vessel use standard PVC insulation with no flame-retardant or low-smoke property.',
    basis: 'Shipboard cables must be flame-retardant (IEC 60332) / LSZH.' },
  { id: 'E-03', category: 'Electrical', expectedIssue: true,
    statement: 'The 440 V IT distribution system has no insulation-level (earth-fault) monitoring device.',
    basis: 'Insulation monitoring with earth-fault alarm is required on unearthed distribution systems.' },
  { id: 'E-04', category: 'Electrical', expectedIssue: true,
    statement: 'The large lead-acid battery compartment is fully enclosed with no ventilation to atmosphere.',
    basis: 'Battery spaces must be ventilated to prevent hydrogen accumulation.' },
  { id: 'S-01', category: 'Safety / LSA', expectedIssue: true,
    statement: 'The vessel carries lifejackets for 90% of the total number of persons on board.',
    basis: 'Lifejackets are required for 100% (plus additional child/watch-keeping) of persons (SOLAS III / LSA Code).' },
  { id: 'S-02', category: 'Safety / LSA', expectedIssue: true,
    statement: 'No independent emergency source of electrical power is fitted; emergency services are fed from the main generators only.',
    basis: 'An independent emergency source of power is required (SOLAS II-1).' },
  { id: 'S-03', category: 'Fire', expectedIssue: true,
    statement: 'Both fire pumps are located in the same machinery space and share a single power supply, with no independent/emergency fire pump.',
    basis: 'Independent power/location and an emergency fire pump are required for redundancy (SOLAS II-2).' },
  { id: 'H-01', category: 'Hull / Structural', expectedIssue: true,
    statement: 'Watertight subdivision bulkheads are fitted with doors that are kept permanently open at sea for crew convenience.',
    basis: 'Watertight doors must be normally closed at sea; permanently open defeats subdivision.' },
  { id: 'P-01', category: 'Piping', expectedIssue: true,
    statement: 'The bilge main is served by a single pump with no alternative or emergency bilge suction.',
    basis: 'Bilge systems require redundancy / emergency bilge suction (class rules / SOLAS).' },
  { id: 'N-01', category: 'Navigation / Alarm', expectedIssue: true,
    statement: 'There is no general emergency alarm system audible throughout the accommodation and working spaces.',
    basis: 'A general emergency alarm audible in all spaces is mandatory (SOLAS III).' },

  // ── Compliant (expectedIssue: false) ────────────────────────────────────────
  { id: 'E-11', category: 'Electrical', expectedIssue: false,
    statement: 'The 440 V distribution system is fitted with an insulation-monitoring device providing an audible and visual earth-fault alarm at the main switchboard.',
    basis: 'Compliant — insulation monitoring with alarm is exactly what is required.' },
  { id: 'E-12', category: 'Electrical', expectedIssue: false,
    statement: 'Fire-resistant cables complying with IEC 60331 are used for circuits required to remain operable during a fire (fire pumps, emergency lighting, alarms).',
    basis: 'Compliant — fire-resistant cabling for survivable circuits is required practice.' },
  { id: 'S-11', category: 'Safety / LSA', expectedIssue: false,
    statement: 'Lifejackets are provided for 105% of persons on board, with additional child lifejackets and lifejackets at watch stations.',
    basis: 'Compliant — meets/exceeds SOLAS III / LSA Code provision.' },
  { id: 'S-12', category: 'Safety / LSA', expectedIssue: false,
    statement: 'An independent emergency generator with an 18-hour fuel supply feeds the emergency switchboard and starts automatically on failure of the main supply.',
    basis: 'Compliant — independent emergency source with auto-start and adequate endurance.' },
  { id: 'H-11', category: 'Hull / Structural', expectedIssue: false,
    statement: 'Watertight subdivision bulkheads extend to the bulkhead deck; any openings use approved watertight doors that are kept closed at sea.',
    basis: 'Compliant — correct watertight subdivision arrangement.' },
  { id: 'V-11', category: 'HVAC', expectedIssue: false,
    statement: 'Machinery-space ventilation provides the required number of air changes and is fitted with fire dampers at the space boundaries, closable from outside the space.',
    basis: 'Compliant — adequate ventilation with boundary fire dampers.' },
];

module.exports = { CASES };
