export function createAuthService(http) {
  return {
    check() {
      return http.request("/api/auth/check");
    },
  };
}
