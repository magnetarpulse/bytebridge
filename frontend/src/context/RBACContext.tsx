import React, { createContext, useContext, ReactNode, useMemo, useCallback } from 'react';
import { useAuth } from './AuthenticationContext';

/**
 * Available user roles in the application.
 * Roles are hierarchical, with GUEST < USER < ADMIN.
 */
export const ROLES = {
  ADMIN: 'admin',
  USER: 'user',
  GUEST: 'guest',
} as const;

/**
 * Available permissions that can be granted to roles.
 * Permissions are assigned to roles via the ROLE_PERMISSIONS mapping.
 */
export const PERMISSIONS = {
  ADMIN: 'admin',
  UPLOAD: 'upload',
  VIEW_ANALYTICS: 'view_analytics',
  MANAGE_TEAMS: 'manage_teams',
  EDIT_SETTINGS: 'edit_settings',
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];
export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

/**
 * Hierarchical ordering of roles from lowest to highest privilege.
 * Used to determine if a user's role meets minimum requirements.
 */
const ROLE_HIERARCHY: ReadonlyArray<Role> = [ROLES.GUEST, ROLES.USER, ROLES.ADMIN];

/**
 * Maps each role to its granted permissions.
 * Permissions are inherited based on role hierarchy - higher roles have more permissions.
 */
const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlyArray<Permission>>> = {
  [ROLES.ADMIN]: [
    PERMISSIONS.ADMIN,
    PERMISSIONS.UPLOAD,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.MANAGE_TEAMS,
    PERMISSIONS.EDIT_SETTINGS,
  ],
  [ROLES.USER]: [
    PERMISSIONS.UPLOAD,
    PERMISSIONS.VIEW_ANALYTICS,
  ],
  [ROLES.GUEST]: [],
};

/**
 * Pre-computed permission checkers for each role.
 * Using Sets provides O(1) lookup time and avoids recreating checkers on each render.
 */
const PERMISSION_CHECKERS = Object.freeze({
  [ROLES.ADMIN]: new Set(ROLE_PERMISSIONS[ROLES.ADMIN]),
  [ROLES.USER]: new Set(ROLE_PERMISSIONS[ROLES.USER]),
  [ROLES.GUEST]: new Set(ROLE_PERMISSIONS[ROLES.GUEST]),
} as const);

/**
 * Pre-computed role hierarchy indices for O(1) comparison.
 */
const ROLE_INDICES = Object.freeze({
  [ROLES.GUEST]: ROLE_HIERARCHY.indexOf(ROLES.GUEST),
  [ROLES.USER]: ROLE_HIERARCHY.indexOf(ROLES.USER),
  [ROLES.ADMIN]: ROLE_HIERARCHY.indexOf(ROLES.ADMIN),
} as const);

/**
 * Context value shape for RBAC functionality.
 * Provides the current user's role and permission checking utilities.
 */
interface RBACContextType {
  /** Current user's role */
  role: Role;
  /** Check if the current user has a specific permission */
  can: (permission: Permission) => boolean;
  /** Check if the current user's role is at or above the required role in hierarchy */
  hasHigherRole: (requiredRole: Role) => boolean;
}

/**
 * User object shape from authentication context.
 * Used to determine user's role based on staff/superuser status.
 */
interface User {
  is_staff?: boolean;
  is_superuser?: boolean;
}

/**
 * Abstract storage interface for role persistence.
 * Allows easy swapping of storage implementations (localStorage, sessionStorage, in-memory, API-based, etc.)
 */
interface RoleStorage {
  getRole(): Role | null;
  setRole(role: Role): void;
}

/**
 * LocalStorage implementation of role storage with error handling.
 * Falls back gracefully if localStorage is unavailable (e.g., private browsing, SSR).
 */
class LocalStorageRoleStorage implements RoleStorage {
  private readonly key = 'userRole';
  private isAvailable: boolean;

  constructor() {
    this.isAvailable = this.checkAvailability();
  }

  private checkAvailability(): boolean {
    try {
      const testKey = '__storage_test__';
      localStorage.setItem(testKey, 'test');
      localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  getRole(): Role | null {
    if (!this.isAvailable) return null;
    
    try {
      const storedRole = localStorage.getItem(this.key);
      return storedRole && this.isValidRole(storedRole) ? storedRole : null;
    } catch {
      return null;
    }
  }

  setRole(role: Role): void {
    if (!this.isAvailable) return;
    
    try {
      localStorage.setItem(this.key, role);
    } catch (error) {
      console.warn('Failed to persist role to localStorage:', error);
    }
  }

  private isValidRole(role: string): role is Role {
    return Object.values(ROLES).includes(role as Role);
  }
}

/**
 * Singleton instance of role storage.
 * Ensures storage availability is checked only once.
 */
const roleStorage = new LocalStorageRoleStorage();

/**
 * Determines a user's role based on their authentication properties.
 * Staff and superusers are assigned ADMIN role, all others receive USER role.
 * 
 * @param user - User object from authentication context
 * @returns Calculated role for the user
 */
const determineUserRole = (user: User | null): Role => {
  if (user?.is_staff || user?.is_superuser) {
    return ROLES.ADMIN;
  }
  return ROLES.USER;
};

/**
 * React context for Role-Based Access Control functionality.
 * Provides role information and permission checking throughout the component tree.
 */
const RBACContext = createContext<RBACContextType | undefined>(undefined);

interface RBACProviderProps {
  children: ReactNode;
  /** Optional custom storage implementation for testing or alternative persistence strategies */
  storage?: RoleStorage;
}

/**
 * Provider component that manages RBAC state and provides it to the component tree.
 * 
 * Automatically determines user role based on authentication status and user properties.
 * Persists role to localStorage for consistency across sessions.
 * Uses memoization and pre-computed data structures for optimal performance.
 * 
 * @example
 * ```tsx
 * <RBACProvider>
 *   <App />
 * </RBACProvider>
 * ```
 */
export const RBACProvider: React.FC<RBACProviderProps> = ({ 
  children, 
  storage = roleStorage 
}) => {
  const { isAuthenticated, user } = useAuth();

  const role = useMemo((): Role => {
    if (!isAuthenticated) return ROLES.GUEST;
    
    const storedRole = storage.getRole();
    if (storedRole && storedRole !== ROLES.GUEST) {
      return storedRole;
    }
    
    const calculatedRole = determineUserRole(user);
    
    // Sync calculated role to storage if different from stored
    if (storedRole !== calculatedRole) {
      storage.setRole(calculatedRole);
    }
    
    return calculatedRole;
  }, [isAuthenticated, user, storage]);

  // Memoize permission checker using pre-computed Set
  const can = useCallback(
    (permission: Permission): boolean => {
      return PERMISSION_CHECKERS[role].has(permission);
    },
    [role]
  );

  // Memoize role hierarchy checker using pre-computed indices
  const hasHigherRole = useCallback(
    (requiredRole: Role): boolean => {
      return ROLE_INDICES[role] >= ROLE_INDICES[requiredRole];
    },
    [role]
  );

  const contextValue = useMemo(
    () => ({ role, can, hasHigherRole }),
    [role, can, hasHigherRole]
  );

  return (
    <RBACContext.Provider value={contextValue}>
      {children}
    </RBACContext.Provider>
  );
};

/**
 * Base hook to access RBAC context.
 * 
 * @throws Error if used outside of RBACProvider
 * @returns RBAC context containing role and permission checking functions
 */
const useRBAC = (): RBACContextType => {
  const context = useContext(RBACContext);
  if (!context) {
    throw new Error('useRBAC must be used within RBACProvider');
  }
  return context;
};

/**
 * Hook to get the current user's role.
 * 
 * @returns Current user role (ADMIN, USER, or GUEST)
 * 
 * @example
 * ```tsx
 * const role = useRole();
 * if (role === ROLES.ADMIN) {
 *   // Show admin UI
 * }
 * ```
 */
export const useRole = (): Role => useRBAC().role;

/**
 * Hook to check if the current user has a specific permission.
 * 
 * @param permission - Permission to check
 * @returns True if user has the permission
 * 
 * @example
 * ```tsx
 * const canUpload = useCan(PERMISSIONS.UPLOAD);
 * ```
 */
export const useCan = (permission: Permission): boolean => 
  useRBAC().can(permission);

/**
 * Hook to check if the current user's role meets or exceeds a required role.
 * Uses role hierarchy to determine privilege level.
 * 
 * @param requiredRole - Minimum role required
 * @returns True if user's role is at or above the required role
 * 
 * @example
 * ```tsx
 * const hasAccess = useHasHigherRole(ROLES.USER);
 * ```
 */
export const useHasHigherRole = (requiredRole: Role): boolean =>
  useRBAC().hasHigherRole(requiredRole);

/**
 * Hook to check if the current user is an admin.
 * Convenience wrapper around useHasHigherRole(ROLES.ADMIN).
 * 
 * @returns True if user has admin role
 * 
 * @example
 * ```tsx
 * const isAdmin = useIsAdmin();
 * return isAdmin ? <AdminPanel /> : <UserDashboard />;
 * ```
 */
export const useIsAdmin = (): boolean => 
  useHasHigherRole(ROLES.ADMIN);

/**
 * Hook to check if the current user can upload content.
 * 
 * @returns True if user has upload permission
 */
export const useCanUpload = (): boolean => 
  useCan(PERMISSIONS.UPLOAD);

/**
 * Hook to check if the current user can manage teams.
 * 
 * @returns True if user has team management permission
 */
export const useCanManageTeams = (): boolean => 
  useCan(PERMISSIONS.MANAGE_TEAMS);

/**
 * Hook to check if the current user can edit application settings.
 * 
 * @returns True if user has settings edit permission
 */
export const useCanEditSettings = (): boolean => 
  useCan(PERMISSIONS.EDIT_SETTINGS);

/**
 * Re-exported role constants for external use.
 * Use these to reference roles in your application code.
 */
export { ROLES as ROLES_CONST, PERMISSIONS as PERMISSIONS_CONST };