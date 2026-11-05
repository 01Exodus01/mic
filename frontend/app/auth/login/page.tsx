'use client';

import { useState, useRef } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { HostLoginSchema } from '@mic/backend/shared/validations';
import { AlertCircle } from 'lucide-react';
import PasswordInput from '@/components/ui/PasswordInput';

export default function LoginPage() {
  const router = useRouter();
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const validateEmail = (val: string): string | null => {
    const res = HostLoginSchema.shape.email.safeParse(val);
    if (!res.success) {
      return res.error.errors[0]?.message || 'Ingresa un correo electrónico válido.';
    }
    return null;
  };

  const validatePassword = (val: string): string | null => {
    const res = HostLoginSchema.shape.password.safeParse(val);
    if (!res.success) {
      return res.error.errors[0]?.message || 'La contraseña es obligatoria.';
    }
    return null;
  };

  const handleEmailBlur = () => {
    setEmailTouched(true);
    setEmailError(validateEmail(email));
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setEmail(next);
    setServerError(null);
    if (emailTouched) {
      setEmailError(validateEmail(next));
    }
  };

  const handlePasswordBlur = () => {
    setPasswordTouched(true);
    setPasswordError(validatePassword(password));
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setPassword(next);
    setServerError(null);
    if (passwordTouched) {
      setPasswordError(validatePassword(next));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setEmailTouched(true);
    setPasswordTouched(true);

    const emErr = validateEmail(email);
    const pwErr = validatePassword(password);
    setEmailError(emErr);
    setPasswordError(pwErr);

    if (emErr) {
      emailInputRef.current?.focus();
      return;
    }
    if (pwErr) {
      passwordInputRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const res = await signIn('credentials', {
        redirect: false,
        email: email.trim().toLowerCase(),
        password,
      });

      if (res?.error) {
        setServerError('Credenciales inválidas. Verifica tu correo y contraseña.');
      } else {
        router.push('/dashboard');
        router.refresh();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al iniciar sesión.';
      setServerError(msg);
    } finally {
      setLoading(false);
    }
  };

  const isEmailInvalid = emailTouched && Boolean(emailError);
  const isPasswordInvalid = passwordTouched && Boolean(passwordError);

  const errorsCount = (isEmailInvalid ? 1 : 0) + (isPasswordInvalid ? 1 : 0);
  const isSubmitDisabled = loading || errorsCount > 0;
  const submitMotive = errorsCount === 1 ? 'Corrige 1 campo' : errorsCount > 1 ? `Corrige ${errorsCount} campos` : '';

  return (
    <main className="flex-1 flex items-center justify-center p-4 sm:p-6 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5">
          <h1 className="font-heading text-2xl font-bold text-[#14171A] tracking-tight">
            Acceso de anfitrión
          </h1>
          <p className="text-xs text-[#5A554E]">
            Ingresa con tus datos para administrar tus salas.
          </p>
        </div>

        {serverError && (
          <div
            id="auth-error-message"
            role="alert"
            className="p-3 rounded-[6px] border border-[#B42318]/30 bg-white text-xs text-[#B42318] flex items-center gap-1.5"
          >
            <AlertCircle className="w-4 h-4 stroke-[1.5] shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <label
              htmlFor="login-email"
              className="block text-xs font-semibold text-[#14171A]"
            >
              Correo electrónico
            </label>
            <input
              ref={emailInputRef}
              id="login-email"
              type="email"
              maxLength={100}
              placeholder="anfitrion@organizacion.com"
              value={email}
              onChange={handleEmailChange}
              onBlur={handleEmailBlur}
              aria-invalid={isEmailInvalid}
              aria-describedby={isEmailInvalid ? 'login-email-error' : undefined}
              className={`w-full h-11 px-3 rounded-[6px] border bg-white text-xs text-[#14171A] placeholder:text-[#5A554E]/50 focus:outline-none transition-colors ${
                isEmailInvalid
                  ? 'border-[#B42318] focus:border-[#B42318]'
                  : 'border-[#D9D5CC] focus:border-[#E4572E]'
              }`}
            />
            {isEmailInvalid && (
              <p id="login-email-error" role="alert" className="text-xs text-[#B42318] mt-1">
                {emailError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="login-password"
              className="block text-xs font-semibold text-[#14171A]"
            >
              Contraseña
            </label>
            <PasswordInput
              ref={passwordInputRef}
              id="login-password"
              autoComplete="current-password"
              maxLength={72}
              placeholder="••••••••"
              value={password}
              onChange={handlePasswordChange}
              onBlur={handlePasswordBlur}
              aria-invalid={isPasswordInvalid}
              aria-describedby={isPasswordInvalid ? 'login-password-error' : undefined}
              className={`h-11 px-3 ${
                isPasswordInvalid
                  ? 'border-[#B42318] focus:border-[#B42318]'
                  : 'border-[#D9D5CC] focus:border-[#E4572E]'
              }`}
            />
            {isPasswordInvalid && (
              <p id="login-password-error" role="alert" className="text-xs text-[#B42318] mt-1">
                {passwordError}
              </p>
            )}
          </div>

          <div className="space-y-1.5 pt-1">
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="w-full h-11 px-4 rounded-[6px] bg-[#E4572E] hover:bg-[#E4572E]/90 text-white text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
            </button>
            {isSubmitDisabled && submitMotive && (
              <p className="text-xs text-[#5A554E] text-center">{submitMotive}</p>
            )}
          </div>
        </form>

        <div className="pt-4 border-t border-[#D9D5CC] text-xs text-[#5A554E]">
          ¿No tienes cuenta de anfitrión?{' '}
          <Link
            href="/auth/register"
            className="text-[#14171A] font-semibold underline underline-offset-2 hover:text-[#E4572E]"
          >
            Crear cuenta
          </Link>
        </div>
      </div>
    </main>
  );
}

