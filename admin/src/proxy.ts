import { NextResponse } from 'next/server';

/** Auth is checked in the browser against Firestore `adminUsers`. */
export function proxy() {
  return NextResponse.next();
}

export const config = {
  matcher: [],
};
