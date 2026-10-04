// Farm Direct — API Middleware
// Handles centralized error interception, safe JSON responses, and security headers.

import { HttpError, json } from './_lib/http.js';

export async function onRequest(context) {
  const { request, next } = context;

  // Handle preflight OPTIONS requests if needed
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }

  try {
    const response = await next();
    return response;
  } catch (err) {
    if (err instanceof HttpError) {
      return json({
        success: false,
        error: err.message,
        ...err.extra
      }, err.status);
    }

    console.error('[Farm API Uncaught Error]:', err);
    return json({
      success: false,
      error: 'An unexpected server error occurred. Please try again.'
    }, 500);
  }
}
