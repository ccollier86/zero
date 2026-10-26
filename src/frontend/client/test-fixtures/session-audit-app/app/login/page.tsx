'use client';
import { LoginForm } from '@zero/framework/react';

export const config = { auth: false };
export const meta = { title: 'Synthetic session sign in' };
export default function LoginPage() { return <LoginForm showRegisterLink={false} showForgotPassword={false} />; }
