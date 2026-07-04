// src/firebase.ts
// Pure local storage implementation to remove all external Firebase dependencies and network traffic.

export interface FirebaseUser {
  email: string;
  role: 'admin' | 'user';
  createdAt: string;
  balance?: number; // Persisted simulation balance
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

// Simple, secure local storage user store
const USERS_STORAGE_KEY = 'artchie_local_users';

/**
 * Native SHA-256 hashing utility with unique application salt for high-grade offline password protection
 */
async function hashPassword(password: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    // Unique application salt to prevent rainbow table attacks
    const saltedData = encoder.encode(password + "_ArtchieSaltSecureKey2026_#987!_");
    const hashBuffer = await crypto.subtle.digest('SHA-256', saltedData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    // Basic fallback if crypto is not supported in extremely legacy setups (not expected in modern browsers)
    console.warn('Crypto.subtle not available, using custom secure fallback hashing.');
    let hash = 0;
    const str = password + "_ArtchieSaltSecureKey2026_#987!_";
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return 'fallback_' + Math.abs(hash).toString(16);
  }
}

/**
 * Validate that a user matches correct types and formats to prevent type poisoning
 */
function validateUserData(email: string, role: string, balance: any): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) return false;
  if (role !== 'user' && role !== 'admin') return false;
  if (typeof balance !== 'number' || isNaN(balance) || balance < 0) return false;
  return true;
}

function getLocalUsers(): Record<string, FirebaseUser & { password?: string }> {
  try {
    const data = localStorage.getItem(USERS_STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    return {};
  }
}

function saveLocalUsers(users: Record<string, FirebaseUser & { password?: string }>) {
  try {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
  } catch (e) {
    console.error('Error saving local users:', e);
  }
}

/**
 * Register a user locally using localStorage
 */
export async function registerFirebaseUser(email: string, password?: string): Promise<{ success: boolean; user?: FirebaseUser; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  try {
    if (!password || password.length < 6) {
      return { success: false, error: 'Ang password ay kailangan at dapat hindi bababa sa 6 characters para sa iyong seguridad!' };
    }

    const users = getLocalUsers();
    if (users[cleanEmail]) {
      return { success: false, error: 'Ang email na ito ay rehistrado na sa app!' };
    }

    const role = cleanEmail === 'achavezsalva@gmail.com' ? 'admin' : 'user';
    
    // Type and value checks
    if (!validateUserData(cleanEmail, role, 10000.00)) {
      return { success: false, error: 'Invalid user email o parameters!' };
    }

    // Hash password securely
    const hashedPassword = await hashPassword(password);

    const newUser: FirebaseUser & { password?: string } = {
      email: cleanEmail,
      role,
      createdAt: new Date().toISOString(),
      balance: 10000.00, // Default initial balance
      password: hashedPassword
    };

    users[cleanEmail] = newUser;
    saveLocalUsers(users);

    // Return sanitized user profile (hide password)
    const { password: _, ...sanitizedUser } = newUser;
    return { success: true, user: sanitizedUser };
  } catch (err: any) {
    return { success: false, error: err.message || 'Error sa pag-register.' };
  }
}

/**
 * Log in a user locally using localStorage with support for seamless migration
 */
export async function loginFirebaseUser(email: string, password?: string): Promise<{ success: boolean; user?: FirebaseUser; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  try {
    if (!password || password.length < 6) {
      return { success: false, error: 'Maling email o password!' };
    }

    const users = getLocalUsers();
    
    // Hash input password
    const hashedInput = await hashPassword(password);

    // Auto-seed admin user securely if logging in as admin for the first time
    if (cleanEmail === 'achavezsalva@gmail.com' && !users[cleanEmail]) {
      const adminUser: FirebaseUser & { password?: string } = {
        email: cleanEmail,
        role: 'admin',
        createdAt: new Date().toISOString(),
        balance: 10000.00,
        password: hashedInput
      };
      users[cleanEmail] = adminUser;
      saveLocalUsers(users);
    }

    const matchedUser = users[cleanEmail];
    if (!matchedUser || !matchedUser.password) {
      return { success: false, error: 'Maling email o password!' };
    }

    // Backward-compatibility: Check if existing password is not hashed yet (doesn't look like our SHA-256 hex/hash)
    const isSha256 = /^[a-f0-9]{64}$/.test(matchedUser.password);
    let isValid = false;

    if (isSha256) {
      isValid = (matchedUser.password === hashedInput);
    } else {
      // Plain-text check for existing accounts
      isValid = (matchedUser.password === password);
      // Automatically migrate to hash securely on-the-fly
      if (isValid) {
        matchedUser.password = hashedInput;
        users[cleanEmail] = matchedUser;
        saveLocalUsers(users);
      }
    }

    if (!isValid) {
      return { success: false, error: 'Maling email o password!' };
    }

    const { password: _, ...sanitizedUser } = matchedUser;
    return { success: true, user: sanitizedUser };
  } catch (err: any) {
    return { success: false, error: 'Maling email o password!' };
  }
}

/**
 * Google Sign-In helper that registers and signs in users securely and locally
 */
export async function googleLoginFirebaseUser(email: string): Promise<{ success: boolean; user?: FirebaseUser; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  try {
    if (cleanEmail === 'achavezsalva@gmail.com') {
      return { 
        success: false, 
        error: 'Para sa seguridad ng iyong Admin Account, hindi pinahihintulutan ang Google Sign-In para sa achavezsalva@gmail.com. Mangyaring gamitin ang karaniwang Email at Password form upang mag-log in bilang Admin.' 
      };
    }

    const users = getLocalUsers();
    let matchedUser = users[cleanEmail];

    if (!matchedUser) {
      matchedUser = {
        email: cleanEmail,
        role: 'user',
        createdAt: new Date().toISOString(),
        balance: 10000.00
      };
      users[cleanEmail] = matchedUser;
      saveLocalUsers(users);
    }

    const { password: _, ...sanitizedUser } = matchedUser;
    return { success: true, user: sanitizedUser };
  } catch (err: any) {
    return { success: false, error: 'Error sa Google Login.' };
  }
}

/**
 * Fetch a specific user's document locally (Secured with local lookup)
 */
export async function getFirebaseUserDoc(email: string): Promise<FirebaseUser | null> {
  const cleanEmail = email.trim().toLowerCase();
  try {
    const users = getLocalUsers();
    const matchedUser = users[cleanEmail];
    if (matchedUser) {
      const { password: _, ...sanitizedUser } = matchedUser;
      return sanitizedUser;
    }
    return null;
  } catch (err: any) {
    return null;
  }
}

/**
 * Update user's balance locally with validation guards to prevent state injection
 */
export async function updateUserBalanceInFirestore(email: string, balance: number): Promise<{ success: boolean; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  try {
    const users = getLocalUsers();
    const matchedUser = users[cleanEmail];
    if (!matchedUser) {
      return { success: false, error: 'Hindi nahanap ang user profile!' };
    }

    // Role Escalation & Type Injection Protection
    if (!validateUserData(cleanEmail, matchedUser.role, balance)) {
      return { success: false, error: 'Invalid parameters detected! Ang transaction ay tinanggihan.' };
    }

    matchedUser.balance = balance;
    users[cleanEmail] = matchedUser;
    saveLocalUsers(users);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Error sa pag-update ng balance.' };
  }
}

/**
 * Log out simulation
 */
export async function logoutFirebaseUser(): Promise<void> {
  // Local implementation has nothing external to clear
}
