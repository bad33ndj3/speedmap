export function pageUrl(location) {
  return `${location.origin}${location.pathname}`;
}

export function isLocalOnly(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
