/*
 * The one place the app asks "may this user do this, and how much of it?" -- and, until a policy
 * file says otherwise, the one place that always answers "yes, all of it".
 *
 * Nothing is gated today (issue #156 is groundwork, not the gate). What is built here is the
 * switch itself, so that the day something does become premium (the family book PDF, #155, is the
 * first candidate) is a change to `policy.json`, not a new release of every screen that exports.
 *
 * Ported to Kotlin as `entitlement/Entitlements.kt`, case for case, sharing one test table --
 * `policy-cases.json` -- so the two shells can never quietly disagree about what somebody is
 * allowed to do. See `docs/premium.md` for the principle this exists to serve: *gate presentation,
 * never a family's own data.*
 *
 * `loadPolicy` and `decide` are pure and synchronous on purpose: no disk, no network, no clock. A
 * Kotlin JVM test and a Node test can then run the exact same inputs through the exact same table
 * and nothing about *how* the policy is stored or delivered can leak into what it decides.
 *
 * Reasons are stable string codes, read by callers deciding what to say -- never user copy:
 *
 *   'unknown-feature'   the policy has nothing to say about what was asked for. This is also what
 *                       a known feature with no rule for the caller's plan produces (below) --
 *                       there is no difference between "never heard of it" and "heard of it, but
 *                       nobody wrote a rule for you", because Allowed must only ever come from a
 *                       rule that says so.
 *   'quota-used'        a `quota` grant governs this feature, whether or not anything has been
 *                       used yet. The decision (Limited vs. Locked) already says how much is left;
 *                       the reason names the mechanism, not the remaining count.
 *   'generation-scope'  a `scope` grant's `maxGenerations` is smaller than what was requested.
 *   'premium-template'  the example this evaluator ships with of a rule overriding its grant's
 *                       default reason with something more specific than 'not-included' -- see
 *                       `defaultReason` below.
 */

/** The only `format` this evaluator understands. Bumped only alongside a matching evaluator change. */
const SUPPORTED_FORMAT = 1;

/**
 * Parses and validates a policy file. Never throws.
 *
 * Returns `null` for anything this evaluator cannot safely read: malformed JSON, a missing `rules`
 * array, or a `format` this build does not recognise -- older or newer. `decide` is what turns
 * that `null` into an actual decision, and it does **not** fail closed; see the comment there.
 */
export function loadPolicy(json) {
  let parsed;
  try {
    parsed = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.format !== SUPPORTED_FORMAT) return null;
  if (!Array.isArray(parsed.rules)) return null;
  return parsed;
}

/** True when every key `when` names matches that same key on `request`. No `when` matches anything. */
function ruleApplies(rule, request) {
  if (!rule.when) return true;
  return Object.entries(rule.when).every(([key, value]) => request[key] === value);
}

/**
 * Picks the rule that governs one request, out of every rule written for its feature and plan.
 *
 * A rule with a `when` clause is more specific than one without, so it wins whenever both match.
 * That is what lets a blanket "book.template is free" rule coexist with a narrower "premium
 * templates are locked" one, rather than making the blanket rule enumerate every tier there is.
 * Order inside `policy.rules` does not matter -- specificity does.
 */
function selectRule(policy, request, plan) {
  const applicable = policy.rules.filter(
    (rule) => rule.feature === request.feature && rule.plan === plan && ruleApplies(rule, request),
  );
  return applicable.find((rule) => rule.when) ?? applicable.find((rule) => !rule.when) ?? null;
}

/** The reason a grant kind produces on its own, before a rule's own `reason` overrides it. */
function defaultReason(kind) {
  if (kind === 'quota') return 'quota-used';
  if (kind === 'scope') return 'generation-scope';
  // A `none` grant with nothing more specific to say. A rule that locks a feature for a reason
  // worth naming -- a premium tier, a sunset feature -- should say so with its own `reason`.
  return 'not-included';
}

function usedCountOf(context, feature) {
  return context?.usage?.[feature] ?? 0;
}

/**
 * Applies one already-matched rule's grant to a request, producing the decision.
 *
 * These four grant kinds are exactly the ones `docs/premium.md` documents as available to a
 * future policy, even though only `"full"` ships today -- so changing the answer later is editing
 * data in `policy.json`, never this function.
 */
function applyGrant(rule, request, context) {
  const { grant } = rule;

  if (grant === 'full') return { kind: 'allowed' };

  if (grant === 'none') {
    return { kind: 'locked', reason: rule.reason ?? defaultReason('none') };
  }

  if (grant && typeof grant === 'object' && grant.quota) {
    const remaining = grant.quota.count - usedCountOf(context, request.feature);
    const reason = rule.reason ?? defaultReason('quota');
    return remaining <= 0
      ? { kind: 'locked', reason }
      : { kind: 'limited', allowance: { remaining }, reason };
  }

  if (grant && typeof grant === 'object' && grant.scope) {
    const { maxGenerations } = grant.scope;
    if ((request.generations ?? 0) <= maxGenerations) return { kind: 'allowed' };
    return {
      kind: 'limited',
      allowance: { maxGenerations },
      reason: rule.reason ?? defaultReason('scope'),
    };
  }

  // A grant this evaluator does not recognise. The top-level `format` check in `loadPolicy` above
  // already ruled out a *file* this build cannot read at all, so this is most likely a typo inside
  // an otherwise-legible policy -- and unlike an unreadable file, a malformed rule is never assumed
  // harmless. The rest of the policy is being followed exactly as written; the one rule that could
  // not be understood stays Locked rather than silently granting what it failed to describe.
  return { kind: 'locked', reason: 'malformed-rule' };
}

/**
 * `decide(policy, request, context) -> {kind:'allowed'} | {kind:'limited', allowance, reason} |
 * {kind:'locked', reason}`
 *
 * `policy` is whatever `loadPolicy` returned, including `null`. An unreadable or newer-format
 * policy comes back from `loadPolicy` as `null`, and the decision for it here is **Allowed**, not
 * Locked -- the one deliberate exception to how every other fallback in this app fails closed.
 * What is being protected here is not a family's data but a business rule, and a corrupted or
 * too-new policy file must never take away an export that worked yesterday. Gate presentation,
 * never data: a broken *gate* is a bug to fix, not a reason to lock people out in the meantime.
 * This is written down again in `docs/premium.md` and exercised in `policy-cases.json`, so the
 * choice is made exactly once.
 */
export function decide(policy, request, context) {
  if (!policy) return { kind: 'allowed' };

  const plan = context?.plan;
  const knownFeature = policy.rules.some((rule) => rule.feature === request.feature);
  if (!knownFeature) return { kind: 'locked', reason: 'unknown-feature' };

  const rule = selectRule(policy, request, plan);
  if (!rule) return { kind: 'locked', reason: 'unknown-feature' };

  return applyGrant(rule, request, context);
}
