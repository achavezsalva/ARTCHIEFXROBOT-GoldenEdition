// src/firebase.ts
// Real Firebase SDK implementation that securely integrates Firestore and Authentication.

import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut,
  sendEmailVerification
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  getDocFromServer 
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const dbId = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== "(default)" 
  ? firebaseConfig.firestoreDatabaseId 
  : undefined;
export const db = dbId ? getFirestore(app, dbId) : getFirestore(app); /* CRITICAL: The app will break without this line */
export const auth = getAuth(app);

export interface FirebaseUser {
  email: string;
  role: 'admin' | 'user';
  createdAt: string;
  balance?: number; // Persisted real database balance
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
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
  };
}

/**
 * Custom secure error handler to throw descriptive JSON error info for debugging
 */
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Test connection on boot to validate setup
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

// Validation utility for Gmail checks (ensures only real Google accounts can join)
function isRealGmail(email: string): boolean {
  const cleanEmail = email.trim().toLowerCase();
  return cleanEmail.endsWith('@gmail.com') || cleanEmail.endsWith('@googlemail.com');
}

/**
 * Register a user to Firebase Auth and create their Firestore record
 */
export async function registerFirebaseUser(email: string, password?: string): Promise<{ success: boolean; user?: FirebaseUser; error?: string; requiresVerification?: boolean }> {
  const cleanEmail = email.trim().toLowerCase();
  
  if (!isRealGmail(cleanEmail)) {
    return { success: false, error: 'Ang portal na ito ay eksklusibo lamang para sa mga tunay na Google/Gmail accounts na nagtatapos sa @gmail.com!' };
  }

  if (!password || password.length < 6) {
    return { success: false, error: 'Ang password ay kailangan at dapat hindi bababa sa 6 characters para sa inyong seguridad!' };
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
    
    // We DO NOT save the initial profile to Firestore here because the user is not yet verified!
    // Writing here will fail Firestore security rules since the email is not verified yet.
    // Instead, the profile will be created once verification succeeds.

    // Send verification email
    try {
      await sendEmailVerification(userCredential.user);
    } catch (sendErr) {
      console.error('Error sending email verification:', sendErr);
    }

    return { 
      success: true, 
      requiresVerification: true, 
      error: 'Matagumpay na na-rehistro! Isang verification link ang ipinadala sa iyong Gmail inbox upang kumpirmahin na ito ay totoong account.' 
    };
  } catch (err: any) {
    console.error('Registration Error:', err);
    let readableError = 'Error sa pag-register.';
    const errStr = String(err && err.message ? err.message : err).toLowerCase();
    const errCode = String(err && err.code ? err.code : '').toLowerCase();
    
    if (errCode === 'auth/email-already-in-use' || errStr.includes('email-already-in-use')) {
      readableError = 'Ang email na ito ay rehistrado na sa app! Mangyaring mag-log in na lamang o gumamit ng ibang email.';
    } else if (errCode === 'auth/invalid-email' || errStr.includes('invalid-email')) {
      readableError = 'Maling format ng email!';
    } else if (errCode === 'auth/weak-password' || errStr.includes('weak-password')) {
      readableError = 'Ang inyong napiling password ay masyadong mahina! Dapat itong maglaman ng hindi bababa sa 6 characters.';
    } else if (errCode === 'auth/too-many-requests' || errStr.includes('too-many-requests')) {
      readableError = 'Masyadong maraming request sa maikling panahon! Mangyaring maghintay muna bago sumubok muli.';
    } else if (err.message) {
      readableError = err.message;
    }
    return { success: false, error: readableError };
  }
}

/**
 * Log in a user to Firebase Auth and fetch/seed their Firestore record
 */
export async function loginFirebaseUser(email: string, password?: string): Promise<{ success: boolean; user?: FirebaseUser; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();

  if (!isRealGmail(cleanEmail)) {
    return { success: false, error: 'Maling email o password! Ang portal na ito ay eksklusibo lamang para sa mga tunay na Google/Gmail accounts.' };
  }

  if (!password || password.length < 6) {
    return { success: false, error: 'Maling email o password!' };
  }

  try {
    const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, password);
    const firebaseUser = userCredential.user;

    // Check if email is verified
    // We can bypass verification for the developer's main admin email to prevent lockouts.
    if (cleanEmail !== 'achavezsalva@gmail.com' && !firebaseUser.emailVerified) {
      // Send another verification link automatically if they try to log in but are unverified
      let resendError = '';
      try {
        await sendEmailVerification(firebaseUser);
      } catch (sendErr: any) {
        console.error('Resend verification link error:', sendErr);
        const sendErrCode = String(sendErr && sendErr.code ? sendErr.code : '').toLowerCase();
        const sendErrStr = String(sendErr && sendErr.message ? sendErr.message : sendErr).toLowerCase();
        if (sendErrCode === 'auth/too-many-requests' || sendErrStr.includes('too-many-requests')) {
          resendError = ' (Paunawa: Hindi maipadala ang panibagong link dahil sa sunod-sunod na request. Mangyaring maghintay muna ng kaunti bago sumubok muli.)';
        }
      }
      await signOut(auth);
      return { 
        success: false, 
        error: `Ang iyong Gmail account ay hindi pa verified! Nagpadala kami ng verification link sa iyong inbox. Mangyaring i-click ito upang mag-log in.${resendError}` 
      };
    }
    
    // Fetch user document from Firestore
    let userDoc = await getFirebaseUserDoc(cleanEmail);
    
    // Auto-seed Firestore document if user is authenticated in Auth but document doesn't exist
    if (!userDoc) {
      const role = cleanEmail === 'achavezsalva@gmail.com' ? 'admin' : 'user';
      userDoc = {
        email: cleanEmail,
        role,
        createdAt: new Date().toISOString(),
        balance: 10000.00
      };
      const docPath = `users/${cleanEmail}`;
      try {
        await setDoc(doc(db, 'users', cleanEmail), userDoc);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, docPath);
      }
    }

    return { success: true, user: userDoc };
  } catch (err: any) {
    console.error('Login Error:', err);
    const errCode = String(err && err.code ? err.code : '').toLowerCase();
    const errStr = String(err && err.message ? err.message : err).toLowerCase();
    
    if (errCode === 'auth/too-many-requests' || errStr.includes('too-many-requests')) {
      return { success: false, error: 'Masyadong maraming maling subok! Mangyaring maghintay muna ng ilang sandali bago sumubok muli.' };
    }
    if (errCode === 'auth/user-not-found' || errStr.includes('user-not-found') || 
        errCode === 'auth/wrong-password' || errStr.includes('wrong-password') ||
        errCode === 'auth/invalid-credential' || errStr.includes('invalid-credential')) {
      return { success: false, error: 'Maling email o password!' };
    }
    
    return { success: false, error: err.message || 'Maling email o password!' };
  }
}

/**
 * Google Sign-In helper (Stubbed/Secured because Google Sign-in was requested to be removed from UI)
 */
export async function googleLoginFirebaseUser(email: string): Promise<{ success: boolean; user?: FirebaseUser; error?: string }> {
  return { 
    success: false, 
    error: 'Ang Google Sign-In ay hindi pinahihintulutan para sa kaligtasan ng account.' 
  };
}

/**
 * Fetch a specific user's document from Firestore
 */
export async function getFirebaseUserDoc(email: string): Promise<FirebaseUser | null> {
  const cleanEmail = email.trim().toLowerCase();
  const docPath = `users/${cleanEmail}`;
  try {
    const docSnap = await getDoc(doc(db, 'users', cleanEmail));
    if (docSnap.exists()) {
      return docSnap.data() as FirebaseUser;
    }
    return null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, docPath);
    return null;
  }
}

/**
 * Force-create or fetch the Firestore user document for a newly verified user
 */
export async function createOrGetVerifiedUserDoc(email: string): Promise<FirebaseUser | null> {
  const cleanEmail = email.trim().toLowerCase();
  const docPath = `users/${cleanEmail}`;
  try {
    let userDoc = await getFirebaseUserDoc(cleanEmail);
    if (!userDoc) {
      const role = cleanEmail === 'achavezsalva@gmail.com' ? 'admin' : 'user';
      userDoc = {
        email: cleanEmail,
        role,
        createdAt: new Date().toISOString(),
        balance: 10000.00
      };
      await setDoc(doc(db, 'users', cleanEmail), userDoc);
    }
    return userDoc;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, docPath);
    return null;
  }
}

/**
 * Update user's balance in Firestore
 */
export async function updateUserBalanceInFirestore(email: string, balance: number): Promise<{ success: boolean; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const docPath = `users/${cleanEmail}`;
  try {
    await updateDoc(doc(db, 'users', cleanEmail), { balance });
    return { success: true };
  } catch (err: any) {
    try {
      handleFirestoreError(err, OperationType.UPDATE, docPath);
    } catch (e: any) {
      return { success: false, error: e.message || 'Error sa pag-update ng balance.' };
    }
    return { success: false, error: err.message || 'Error sa pag-update ng balance.' };
  }
}

/**
 * Log out from Firebase Auth
 */
export async function logoutFirebaseUser(): Promise<void> {
  try {
    await signOut(auth);
  } catch (err) {
    console.error('Error logging out:', err);
  }
}
