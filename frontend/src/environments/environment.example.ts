export const environment = {
  production: false,
  useApi: true,
  apiBaseUrl: '/api',
  /** Public GitHub OAuth App Client ID (secret stays on the backend later) */
  githubClientId: 'PUT_YOUR_GITHUB_CLIENT_ID_HERE',
  githubRedirectUri: 'http://localhost:4200/auth/github/callback',
  githubScopes: 'read:user repo user:email workflow',
  portainerBaseUrl: '/portainer-api',
  portainerToken: 'PUT_YOUR_PORTAINER_TOKEN_HERE',
  portainerEndpointId: 3
};
