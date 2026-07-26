/**
 * A string that is allowed to reach the model.
 *
 * The brand exists so that "we remember to sanitise" becomes "it does not
 * compile otherwise". Renderers — table(), facts(), envelope() — accept only
 * `Safe`, and the only ways to obtain one are:
 *
 *   sanitize()      third-party text, put through the allowlist
 *   the formatters  numbers we parsed and re-rendered ourselves
 *   lit()           text written in this repository
 *
 * scripts/audit.mjs fails the build on any `as Safe` cast outside this file,
 * so the escape hatch cannot be widened quietly.
 */

declare const safeBrand: unique symbol;

export type Safe = string & { readonly [safeBrand]: "safe" };

/**
 * Text authored here, in the source, by us. Never call this on anything that
 * came off the network — that is what sanitize() is for.
 */
export function lit(text: string): Safe {
  return text as Safe;
}

/** Concatenate safe fragments. The result is safe because the parts are. */
export function cat(...parts: Safe[]): Safe {
  return parts.join("") as Safe;
}

/** Join safe fragments with a separator of our own choosing. */
export function joinSafe(parts: Safe[], separator: string): Safe {
  return parts.join(separator) as Safe;
}
