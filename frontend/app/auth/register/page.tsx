'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { registerHost } from '@/app/actions/auth';
import { HostRegisterSchema, HostInviteCodeSchema } from '@mic/backend/shared/validations';
import { AlertCircle } from 'lucide-react';
import PasswordInput from '@/components/ui/PasswordInput';

export default function RegisterPage() {
  const router = useRouter();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const inviteCodeInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [inviteCode, setInviteCode] = useState('');
  const [inviteCodeTouched, setInviteCodeTouched] = useState(false);
  const [inviteCodeError, setInviteCodeError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const validateName = (val: string): string | null => {
    const res = HostRegisterSchema.shape.name.safeParse(val);
    if (!res.success) {
      return res.error.errors[0]?.message || 'El nombre es obligatorio.';
    }
    return null;
  };

  const validateEmail = (val: string): string | null => {
    const res = HostRegisterSchema.shape.email.safeParse(val);
    if (!res.success) {
      return res.error.errors[0]?.message || 'Ingresa un correo electrónico válido.';
    }
    return null;
  };

  const validatePassword = (val: string): string | null => {
    const res = HostRegisterSchema.shape.password.safeParse(val);
    if (!res.success) {
      return res.error.errors[0]?.message || 'Mínimo 8 caracteres.';
    }
    return null;
  };

  const validateInviteCode = (val: string): string | null => {
    const res = HostInviteCodeSchema.safeParse(val);
    if (!res.success) {
      return res.error.errors[0]?.message || 'El código de invitación es obligatorio.';
    }
    return null;
  };

  const handleInviteCodeBlur = () => {
    setInviteCodeTouched(true);
    setInviteCodeError(validateInviteCode(inviteCode));
  };

  const handleInviteCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setInviteCode(next);
    setServerError(null);
    if (inviteCodeTouched) {
      setInviteCodeError(validateInviteCode(next));
    }
  };

  const handleNameBlur = () => {
    setNameTouched(true);
    setNameError(validateName(name));
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setName(next);
    setServerError(null);
    if (nameTouched) {
      setNameError(validateName(next));
    }
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
    setNameTouched(true);
    setEmailTouched(true);
    setPasswordTouched(true);
    setInviteCodeTouched(true);

    const nmErr = validateName(name);
    const emErr = validateEmail(email);
    const pwErr = validatePassword(password);
    const icErr = validateInviteCode(inviteCode);

    setNameError(nmErr);
    setEmailError(emErr);
    setPasswordError(pwErr);
    setInviteCodeError(icErr);

    if (nmErr) {
      nameInputRef.current?.focus();
      return;
    }
    if (emErr) {
      emailInputRef.current?.focus();
      return;
    }
    if (pwErr) {
      passwordInputRef.current?.focus();
      return;
    }
    if (icErr) {
      inviteCodeInputRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const res = await registerHost(name, email, password, inviteCode);
      if (res.success) {
        setSuccess(true);
        setTimeout(() => router.push('/auth/login'), 1500);
      } else {
        setServerError(res.error || 'No fue posible crear la cuenta.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar la cuenta.';
      setServerError(msg);
    } finally {
      setLoading(false);
    }
  };

  const isNameInvalid = nameTouched && Boolean(nameError);
  const isEmailInvalid = emailTouched && Boolean(emailError);
  const isPasswordInvalid = passwordTouched && Boolean(passwordError);
  const isInviteCodeInvalid = inviteCodeTouched && Boolean(inviteCodeError);

  const errorsCount =
    (isNameInvalid ? 1 : 0) +
    (isEmailInvalid ? 1 : 0) +
    (isPasswordInvalid ? 1 : 0) +
    (isInviteCodeInvalid ? 1 : 0);
  const isSubmitDisabled = loading || success || errorsCount > 0;
  const submitMotive = errorsCount === 1 ? 'Corrige 1 campo' : errorsCount > 1 ? `Corrige ${errorsCount} campos` : '';

  return (
    <main className="flex-1 flex items-center justify-center p-4 sm:p-6 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5">
          <h1 className="font-heading text-2xl font-bold text-[#14171A] tracking-tight">
            Crear cuenta de anfitrión
          </h1>
          <p className="text-xs text-[#5A554E]">
            Registra tus datos para organizar actividades y salas.
          </p>
        </div>

        {serverError && (
          <div
            id="auth-register-error"
            role="alert"
            className="p-3 rounded-[6px] border border-[#B42318]/30 bg-white text-xs text-[#B42318] flex items-center gap-1.5"
          >
            <AlertCircle className="w-4 h-4 stroke-[1.5] shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        {success && (
          <div className="p-3 rounded-[6px] border border-[#2F7D4F]/30 bg-white text-xs text-[#2F7D4F] font-medium">
            Cuenta creada. Redirigiendo al inicio de sesión...
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="register-name"
                className="block text-xs font-semibold text-[#14171A]"
              >
                Nombre completo
              </label>
              <span
                className={`font-mono text-xs ${
                  name.length >= 30 ? 'text-[#B7791F] font-bold' : 'text-[#5A554E]'
                }`}
              >
                {name.length}/30
              </span>
            </div>
            <input
              ref={nameInputRef}
              id="register-name"
              type="text"
              maxLength={30}
              placeholder="Nombre y apellido"
              value={name}
              onChange={handleNameChange}
              onBlur={handleNameBlur}
              aria-invalid={isNameInvalid}
              aria-describedby={isNameInvalid ? 'register-name-error' : undefined}
              className={`w-full h-11 px-3 rounded-[6px] border bg-white text-xs text-[#14171A] placeholder:text-[#5A554E]/50 focus:outline-none transition-colors ${
                isNameInvalid
                  ? 'border-[#B42318] focus:border-[#B42318]'
                  : 'border-[#D9D5CC] focus:border-[#E4572E]'
              }`}
            />
            {isNameInvalid && (
              <p id="register-name-error" role="alert" className="text-xs text-[#B42318] mt-1">
                {nameError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="register-email"
              className="block text-xs font-semibold text-[#14171A]"
            >
              Correo electrónico
            </label>
            <input
              ref={emailInputRef}
              id="register-email"
              type="email"
              maxLength={100}
              placeholder="anfitrion@organizacion.com"
              value={email}
              onChange={handleEmailChange}
              onBlur={handleEmailBlur}
              aria-invalid={isEmailInvalid}
              aria-describedby={isEmailInvalid ? 'register-email-error' : undefined}
              className={`w-full h-11 px-3 rounded-[6px] border bg-white text-xs text-[#14171A] placeholder:text-[#5A554E]/50 focus:outline-none transition-colors ${
                isEmailInvalid
                  ? 'border-[#B42318] focus:border-[#B42318]'
                  : 'border-[#D9D5CC] focus:border-[#E4572E]'
              }`}
            />
            {isEmailInvalid && (
              <p id="register-email-error" role="alert" className="text-xs text-[#B42318] mt-1">
                {emailError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="register-password"
              className="block text-xs font-semibold text-[#14171A]"
            >
              Contraseña (8 a 72 caracteres)
            </label>
            <PasswordInput
              ref={passwordInputRef}
              id="register-password"
              autoComplete="new-password"
              maxLength={72}
              placeholder="••••••••"
              value={password}
              onChange={handlePasswordChange}
              onBlur={handlePasswordBlur}
              aria-invalid={isPasswordInvalid}
              aria-describedby={isPasswordInvalid ? 'register-password-error' : undefined}
              className={`h-11 px-3 ${
                isPasswordInvalid
                  ? 'border-[#B42318] focus:border-[#B42318]'
                  : 'border-[#D9D5CC] focus:border-[#E4572E]'
              }`}
            />
            {isPasswordInvalid && (
              <p id="register-password-error" role="alert" className="text-xs text-[#B42318] mt-1">
                {passwordError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="register-invite-code"
              className="block text-xs font-semibold text-[#14171A]"
            >
              Código de invitación
            </label>
            <PasswordInput
              ref={inviteCodeInputRef}
              id="register-invite-code"
              autoComplete="off"
              maxLength={200}
              value={inviteCode}
              onChange={handleInviteCodeChange}
              onBlur={handleInviteCodeBlur}
              aria-invalid={isInviteCodeInvalid}
              aria-describedby={isInviteCodeInvalid ? 'register-invite-code-error' : 'register-invite-code-help'}
              className={`h-11 px-3 ${
                isInviteCodeInvalid
                  ? 'border-[#B42318] focus:border-[#B42318]'
                  : 'border-[#D9D5CC] focus:border-[#E4572E]'
              }`}
            />
            {isInviteCodeInvalid ? (
              <p id="register-invite-code-error" role="alert" className="text-xs text-[#B42318] mt-1">
                {inviteCodeError}
              </p>
            ) : (
              <p id="register-invite-code-help" className="text-xs text-[#5A554E] mt-1">
                Lo entrega quien administra la plataforma.
              </p>
            )}
          </div>

          <div className="space-y-1.5 pt-1">
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="w-full h-11 px-4 rounded-[6px] bg-[#E4572E] hover:bg-[#E4572E]/90 text-white text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Creando cuenta...' : 'Crear cuenta'}
            </button>
            {isSubmitDisabled && submitMotive && (
              <p className="text-xs text-[#5A554E] text-center">{submitMotive}</p>
            )}
          </div>
        </form>

        <div className="pt-4 border-t border-[#D9D5CC] text-xs text-[#5A554E]">
          ¿Ya tienes cuenta de anfitrión?{' '}
          <Link
            href="/auth/login"
            className="text-[#14171A] font-semibold underline underline-offset-2 hover:text-[#E4572E]"
          >
            Iniciar sesión
          </Link>
        </div>
      </div>
    </main>
  );
}

