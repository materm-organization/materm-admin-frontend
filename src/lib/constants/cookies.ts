// Cookie keys shared between the axios layer, the auth hooks and the route
// guard. JWT tokens live in cookies (js-cookie), never in Redux/localStorage.
export const ACCESS_TOKEN_COOKIE = "app_access_token";
export const REFRESH_TOKEN_COOKIE = "app_refresh_token";
