const APP_HOSTNAME = window.location.hostname || 'localhost';
const APP_SECURE = window.location.protocol === 'https:';
const API_PROTOCOL = APP_SECURE ? 'https' : 'http';

export const API_BASE_URL = `${API_PROTOCOL}://${APP_HOSTNAME}:5000`;
