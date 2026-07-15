export function adminAuthHeaders(json = false, extra: HeadersInit = {}): HeadersInit {
  const token = localStorage.getItem('mahad-token');
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}
