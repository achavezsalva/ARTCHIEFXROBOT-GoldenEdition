import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where 
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase App
const app = initializeApp({
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  storageBucket: firebaseConfig.storageBucket,
  messagingSenderId: firebaseConfig.messagingSenderId,
  appId: firebaseConfig.appId
});

// Initialize Firestore with specific Database ID from config
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');

// Interface for Users stored in Firebase Firestore
export interface FirebaseUser {
  email: string;
  password?: string; // Optional for Google sign-in
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

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null,
      email: null,
      emailVerified: null,
      isAnonymous: null,
      tenantId: null,
      providerInfo: []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Register a user in Firestore
 */
export async function registerFirebaseUser(email: string, password?: string): Promise<{ success: boolean; user?: FirebaseUser; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const path = `users/${cleanEmail}`;
  try {
    const userDocRef = doc(db, 'users', cleanEmail);
    const userDoc = await getDoc(userDocRef);

    if (userDoc.exists()) {
      return { success: false, error: 'Ang email na ito ay rehistrado na sa Firebase!' };
    }

    if (!password || password.length < 6) {
      return { success: false, error: 'Ang password ay kailangan at dapat hindi bababa sa 6 characters para sa iyong seguridad!' };
    }

    const role = cleanEmail === 'achavezsalva@gmail.com' ? 'admin' : 'user';
    const newUser: FirebaseUser = {
      email: cleanEmail,
      role,
      createdAt: new Date().toISOString(),
      password: password,
      balance: 10000.00 // Default initial balance
    };

    await setDoc(userDocRef, newUser);
    return { success: true, user: newUser };
  } catch (err: any) {
    console.error('Firestore Register Error:', err);
    try {
      handleFirestoreError(err, OperationType.WRITE, path);
    } catch (e: any) {
      return { success: false, error: e.message || 'Error sa pag-save sa Firestore' };
    }
    return { success: false, error: err.message || 'Error sa pag-save sa Firestore' };
  }
}

/**
 * Log in a user using email and password against Firestore
 */
export async function loginFirebaseUser(email: string, password?: string): Promise<{ success: boolean; user?: FirebaseUser; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const path = `users/${cleanEmail}`;
  try {
    const userDocRef = doc(db, 'users', cleanEmail);
    const userDoc = await getDoc(userDocRef);

    if (!password || password.length < 6) {
      return { success: false, error: 'Maling email o password! Ang password ay dapat may haba na 6 characters o higit pa.' };
    }

    // Auto-seed admin if logging in for the first time
    if (!userDoc.exists() && cleanEmail === 'achavezsalva@gmail.com') {
      const newUser: FirebaseUser = {
        email: cleanEmail,
        password: password,
        role: 'admin',
        createdAt: new Date().toISOString(),
        balance: 10000.00
      };
      await setDoc(userDocRef, newUser);
      return { success: true, user: newUser };
    }

    if (!userDoc.exists()) {
      return { success: false, error: 'Maling email o password!' };
    }

    const userData = userDoc.data() as FirebaseUser;
    if (userData.password !== password) {
      return { success: false, error: 'Maling email o password!' };
    }

    // Ensure they have a balance if old records didn't set one
    if (userData.balance === undefined) {
      userData.balance = 10000.00;
      await setDoc(userDocRef, userData, { merge: true });
    }

    return { success: true, user: userData };
  } catch (err: any) {
    console.error('Firestore Login Error:', err);
    try {
      handleFirestoreError(err, OperationType.GET, path);
    } catch (e: any) {
      return { success: false, error: e.message || 'Error sa pag-fetch sa Firestore' };
    }
    return { success: false, error: err.message || 'Error sa pag-fetch sa Firestore' };
  }
}

/**
 * Google Sign-In helper that upserts the user in Firestore
 */
export async function googleLoginFirebaseUser(email: string): Promise<{ success: boolean; user?: FirebaseUser; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const path = `users/${cleanEmail}`;
  try {
    // CRITICAL SECURITY CHECK: Block admin email from Google Login to prevent any bypass
    if (cleanEmail === 'achavezsalva@gmail.com') {
      return { 
        success: false, 
        error: 'Para sa seguridad ng iyong Admin Account, hindi pinahihintulutan ang Google Sign-In para sa achavezsalva@gmail.com. Mangyaring gamitin ang karaniwang Email at Password form upang mag-log in bilang Admin.' 
      };
    }

    const userDocRef = doc(db, 'users', cleanEmail);
    const userDoc = await getDoc(userDocRef);

    const role = 'user'; // Admin is restricted to password login only

    if (userDoc.exists()) {
      const userData = userDoc.data() as FirebaseUser;
      // Force non-admin role if logged in via Google with a non-admin email
      if (userData.role !== 'user') {
        userData.role = 'user';
      }
      // If balance does not exist in old records, add default balance
      if (userData.balance === undefined) {
        userData.balance = 10000.00;
      }
      await setDoc(userDocRef, userData, { merge: true });
      return { success: true, user: userData };
    }

    const newUser: FirebaseUser = {
      email: cleanEmail,
      role,
      createdAt: new Date().toISOString(),
      balance: 10000.00
    };

    await setDoc(userDocRef, newUser);
    return { success: true, user: newUser };
  } catch (err: any) {
    console.error('Firestore Google Sign-In Error:', err);
    try {
      handleFirestoreError(err, OperationType.WRITE, path);
    } catch (e: any) {
      return { success: false, error: e.message || 'Error sa pag-save sa Firestore' };
    }
    return { success: false, error: err.message || 'Error sa pag-save sa Firestore' };
  }
}

/**
 * Fetch a specific user's document to get the latest balance
 */
export async function getFirebaseUserDoc(email: string): Promise<FirebaseUser | null> {
  const cleanEmail = email.trim().toLowerCase();
  const path = `users/${cleanEmail}`;
  try {
    const userDocRef = doc(db, 'users', cleanEmail);
    const userDoc = await getDoc(userDocRef);
    if (userDoc.exists()) {
      return userDoc.data() as FirebaseUser;
    }
    return null;
  } catch (err: any) {
    console.error('Firestore Get User Error:', err);
    handleFirestoreError(err, OperationType.GET, path);
    return null;
  }
}

/**
 * Update user's balance in Firestore
 */
export async function updateUserBalanceInFirestore(email: string, balance: number): Promise<{ success: boolean; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const path = `users/${cleanEmail}`;
  try {
    const userDocRef = doc(db, 'users', cleanEmail);
    await setDoc(userDocRef, { balance }, { merge: true });
    return { success: true };
  } catch (err: any) {
    console.error('Firestore Update Balance Error:', err);
    try {
      handleFirestoreError(err, OperationType.WRITE, path);
    } catch (e: any) {
      return { success: false, error: e.message || 'Error sa pag-update ng balance sa Firestore' };
    }
    return { success: false, error: err.message || 'Error sa pag-update ng balance sa Firestore' };
  }
}
