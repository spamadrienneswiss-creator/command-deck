// Points shared/core.js at the in-memory fake for tests.
export async function resolve(specifier, context, next) {
  if (/shared\/core\.js(\?.*)?$/.test(specifier)) return next(new URL('./fake-fb.mjs', import.meta.url).href, context);
  return next(specifier, context);
}
