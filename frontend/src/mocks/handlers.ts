import { http, HttpResponse } from 'msw';

/**
 * Mock Handlers for ByteBridge API
 * 
 * @remarks
 * This module defines Mock Service Worker (MSW) request handlers that intercept
 * HTTP requests and return mock responses. This enables frontend development and
 * testing without connecting to actual API endpoints.
 * 
 * All handlers use wildcard patterns (`*`) to match requests regardless of origin,
 * making them work in various development environments.
 * 
 * @see {@link https://mswjs.io/docs/basics/request-handler MSW Request Handlers}
 */

/**
 * Mock user object returned by authentication endpoints.
 */
const mockUser = {
  id: 1,
  username: 'testuser',
  email: 'test@bytebridge.com',
  first_name: 'Test',
  last_name: 'User',
};

/**
 * Mock JWT tokens for authentication.
 */
const mockTokens = {
  access: 'mock-access-token-12345',
  refresh: 'mock-refresh-token-67890',
};

/**
 * Array of request handlers for MSW.
 * 
 * @remarks
 * Handlers are processed in order. More specific handlers should be placed
 * before catch-all handlers to ensure proper matching.
 */
export const handlers = [
  /**
   * Authentication Status Check
   * 
   * Returns the current user's authentication status and user data.
   * 
   * @endpoint GET /users/auth-status/
   * @returns Authentication status and user object
   */
  http.get('*/users/auth-status/', () => {
    return HttpResponse.json({
      isAuthenticated: true,
      user: mockUser,
    });
  }),

  /**
   * User Login
   * 
   * Authenticates a user and returns JWT tokens and user data.
   * 
   * @endpoint POST /users/login/
   * @param request - Request body should contain username/email and password
   * @returns JWT access and refresh tokens, plus user object
   */
  http.post('*/users/login/', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({
      ...mockTokens,
      user: mockUser,
    });
  }),

  /**
   * User Logout
   * 
   * Logs out the current user by invalidating their session.
   * 
   * @endpoint POST /users/logout/
   * @returns Success message
   */
  http.post('*/users/logout/', () => {
    return HttpResponse.json({ message: 'Logged out successfully' });
  }),

  /**
   * JWT Token Refresh
   * 
   * Refreshes an expired access token using a valid refresh token.
   * 
   * @endpoint POST /api/token/refresh/
   * @returns New access token
   */
  http.post('*/api/token/refresh/', () => {
    return HttpResponse.json({ access: mockTokens.access });
  }),

  /**
   * Upload Initialization (Primary Endpoint)
   * 
   * Initializes a file upload session and returns upload parameters.
   * 
   * @endpoint POST /api/v1/upload/init/
   * @returns Upload ID and chunk size configuration
   */
  http.post('*/api/v1/upload/init/', async ({ request }) => {
    return HttpResponse.json({
      uploadId: `mock-upload-${Date.now()}`,
      chunkSize: 2 * 1024 * 1024, // 2MB chunks
    });
  }),

  /**
   * Upload Initialization (Alternative Endpoint)
   * 
   * Alternative endpoint for upload initialization with identical behavior.
   * 
   * @endpoint POST /api/v1/upload/initialize/
   * @returns Upload ID and chunk size configuration
   */
  http.post('*/api/v1/upload/initialize/', async ({ request }) => {
    return HttpResponse.json({
      uploadId: `mock-upload-${Date.now()}`,
      chunkSize: 2 * 1024 * 1024, // 2MB chunks
    });
  }),

  /**
   * Chunk Upload
   * 
   * Handles individual file chunk uploads during a multi-part upload.
   * Simulates processing delay to mimic real network conditions.
   * 
   * @endpoint POST /api/v1/upload/chunk/
   * @param request - Request body should contain chunk data and upload ID
   * @returns Success status
   */
  http.post('*/api/v1/upload/chunk/', async ({ request }) => {
    // Simulate network processing delay (50ms)
    await new Promise(resolve => setTimeout(resolve, 50));
    return HttpResponse.json({ success: true });
  }),

  /**
   * Upload Complete (Primary Endpoint)
   * 
   * Finalizes an upload session after all chunks have been uploaded.
   * 
   * @endpoint POST /api/v1/upload/complete/
   * @param request - Request body should contain upload ID and filename
   * @returns File ID and filename confirmation
   */
  http.post('*/api/v1/upload/complete/', async ({ request }) => {
    const body: any = await request.json();
    return HttpResponse.json({
      success: true,
      fileId: `file-${Date.now()}`,
      filename: body?.filename || 'uploaded-file.gz.enc',
    });
  }),

  /**
   * Upload Complete (Alternative Endpoint)
   * 
   * Alternative endpoint for upload completion with identical behavior.
   * 
   * @endpoint POST /api/upload/v1/complete/
   * @param request - Request body should contain upload ID and filename
   * @returns File ID and filename confirmation
   */
  http.post('*/api/upload/v1/complete/', async ({ request }) => {
    const body: any = await request.json();
    return HttpResponse.json({
      success: true,
      fileId: `file-${Date.now()}`,
      filename: body?.filename || 'uploaded-file.gz.enc',
    });
  }),

  /**
   * Simple Upload Endpoint
   * 
   * Handles simple, single-request file uploads (non-chunked).
   * Simulates upload processing delay.
   * 
   * @endpoint POST /api/upload/
   * @param request - Request body should contain file data
   * @returns File ID and success message
   */
  http.post('*/api/upload/', async ({ request }) => {
    // Simulate upload processing delay (100ms)
    await new Promise(resolve => setTimeout(resolve, 100));
    return HttpResponse.json({
      success: true,
      fileId: `file-${Date.now()}`,
      message: 'File uploaded successfully',
    });
  }),

  /**
   * List Files
   * 
   * Returns a paginated list of files uploaded by the current user.
   * 
   * @endpoint GET /api/v1/files/
   * @returns Array of file objects with metadata
   */
  http.get('*/api/v1/files/', () => {
    return HttpResponse.json({
      results: [
        {
          id: 1,
          filename: 'test-file-1.gz.enc',
          size: 1024 * 1024 * 5, // 5MB
          uploaded_at: new Date().toISOString(),
          status: 'completed',
        },
        {
          id: 2,
          filename: 'test-file-2.gz.enc',
          size: 1024 * 1024 * 10, // 10MB
          uploaded_at: new Date().toISOString(),
          status: 'completed',
        },
      ],
      count: 2,
    });
  }),

  /**
   * Download File
   * 
   * Downloads a file by ID, returning encrypted file data.
   * 
   * @endpoint GET /api/v1/files/:id/download/
   * @param params - URL parameters including file ID
   * @returns Binary file data as ArrayBuffer
   */
  http.get('*/api/v1/files/:id/download/', ({ params }) => {
    // Return mock encrypted data (1KB of 'A' characters)
    const mockData = new Uint8Array(1024).fill(65);
    return HttpResponse.arrayBuffer(mockData.buffer);
  }),

  /**
   * User Registration
   * 
   * Creates a new user account.
   * 
   * @endpoint POST /users/register/
   * @param request - Request body should contain username, email, and password
   * @returns Success status and created user data
   */
  http.post('*/users/register/', async ({ request }) => {
    const body: any = await request.json();
    return HttpResponse.json({
      success: true,
      data: { 
        ...mockUser, 
        username: body?.username || 'newuser', 
        email: body?.email || 'newuser@bytebridge.com' 
      },
      message: 'User created successfully',
    });
  }),

  /**
   * Check Admin Status
   * 
   * Checks if the current user has administrative privileges.
   * 
   * @endpoint GET /users/check-admin-status/
   * @returns Admin, superuser, and staff status flags
   */
  http.get('*/users/check-admin-status/', () => {
    return HttpResponse.json({
      isAdmin: true,
      isSuperuser: true,
      isStaff: true,
    });
  }),

  /**
   * Password Reset Request
   * 
   * Initiates a password reset flow by sending a reset email.
   * 
   * @endpoint POST /users/password-reset/
   * @param request - Request body should contain email address
   * @returns Success status and message
   */
  http.post('*/users/password-reset/', async ({ request }) => {
    const body: any = await request.json();
    return HttpResponse.json({
      success: true,
      message: 'Password reset email sent',
    });
  }),

  /**
   * Password Reset Confirmation
   * 
   * Completes the password reset flow with a new password.
   * 
   * @endpoint POST /users/password-reset-confirm/
   * @param request - Request body should contain reset token and new password
   * @returns Success status and message
   */
  http.post('*/users/password-reset-confirm/', async ({ request }) => {
    const body: any = await request.json();
    return HttpResponse.json({
      success: true,
      message: 'Password reset successful',
    });
  }),

  /**
   * Get User Profile
   * 
   * Retrieves the current user's profile information.
   * 
   * @endpoint GET /users/profile/
   * @returns User data and profile information
   */
  http.get('*/users/profile/', () => {
    return HttpResponse.json({
      success: true,
      data: {
        ...mockUser,
        profile: {
          auth_token: mockTokens.access,
          bio: 'Mock user profile',
          avatar: null,
        },
      },
    });
  }),

  /**
   * Update User Profile
   * 
   * Updates the current user's profile information.
   * 
   * @endpoint PUT /users/profile/
   * @param request - Request body should contain updated profile fields
   * @returns Updated user data
   */
  http.put('*/users/profile/', async ({ request }) => {
    const body: any = await request.json();
    return HttpResponse.json({
      success: true,
      data: { ...mockUser, ...body },
      message: 'Profile updated successfully',
    });
  }),

  /**
   * Catch-All Handler: Unhandled User Endpoints
   * 
   * Handles any user-related API requests that don't match specific handlers.
   * Returns 501 Not Implemented status and logs a warning.
   * 
   * @remarks
   * This handler has lower priority and should remain near the end of the handlers array.
   * 
   * @endpoint ALL /users/*
   * @returns Error response with 501 status
   */
  http.all('*/users/*', ({ request }) => {
    console.warn(`[MSW] Unhandled users API request: ${request.method} ${request.url}`);
    return HttpResponse.json({ error: 'Not implemented in mock' }, { status: 501 });
  }),

  /**
   * Catch-All Handler: Unhandled API Endpoints
   * 
   * Handles any API requests that don't match specific handlers.
   * Returns 501 Not Implemented status and logs a warning.
   * 
   * @remarks
   * This handler has lower priority and should remain at the end of the handlers array.
   * 
   * @endpoint ALL /api/*
   * @returns Error response with 501 status
   */
  http.all('*/api/*', ({ request }) => {
    console.warn(`[MSW] Unhandled API request: ${request.method} ${request.url}`);
    return HttpResponse.json({ error: 'Not implemented in mock' }, { status: 501 });
  }),
];