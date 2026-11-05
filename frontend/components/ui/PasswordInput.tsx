'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PasswordInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  isPin?: boolean;
}

export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, isPin = false, disabled, ...props }, ref) => {
    const [showPassword, setShowPassword] = React.useState(false);
    const innerRef = React.useRef<HTMLInputElement>(null);

    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);

    React.useEffect(() => {
      // Auto-ocultar al perder el foco de la pantalla o cambiar de pestaña (AUD-21)
      const handleVisibilityChange = () => {
        if (document.hidden) {
          setShowPassword(false);
        }
      };

      const handleWindowBlur = () => {
        setShowPassword(false);
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('blur', handleWindowBlur);

      // Auto-ocultar al enviar el formulario (AUD-21)
      const input = innerRef.current;
      const form = input?.form;
      const handleFormSubmit = () => {
        setShowPassword(false);
      };

      if (form) {
        form.addEventListener('submit', handleFormSubmit);
      }

      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('blur', handleWindowBlur);
        if (form) {
          form.removeEventListener('submit', handleFormSubmit);
        }
      };
    }, []);

    const toggleVisibility = () => {
      const input = innerRef.current;
      let start: number | null = null;
      let end: number | null = null;

      if (input) {
        start = input.selectionStart;
        end = input.selectionEnd;
      }

      setShowPassword((prev) => !prev);

      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => {
          if (input && start !== null && end !== null) {
            input.focus();
            input.setSelectionRange(start, end);
          }
        });
      }
    };

    const label = isPin
      ? showPassword
        ? 'Ocultar PIN'
        : 'Mostrar PIN'
      : showPassword
      ? 'Ocultar contraseña'
      : 'Mostrar contraseña';

    return (
      <div className="relative w-full flex items-center">
        <input
          ref={innerRef}
          type={showPassword ? 'text' : 'password'}
          disabled={disabled}
          maxLength={isPin ? 4 : props.maxLength}
          inputMode={isPin ? 'numeric' : props.inputMode}
          pattern={isPin ? '[0-9]*' : props.pattern}
          className={cn(
            'w-full rounded-[6px] border border-[#D9D5CC] bg-white text-xs text-[#14171A] placeholder:text-[#5A554E]/50 focus:outline-none transition-colors pr-11',
            isPin && 'font-mono text-center tracking-widest',
            className
          )}
          {...props}
        />
        <button
          type="button"
          onClick={toggleVisibility}
          disabled={disabled}
          aria-label={label}
          aria-pressed={showPassword}
          tabIndex={0}
          className="absolute right-0 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center text-[#5A554E] hover:text-[#14171A] disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus-visible:ring-1 focus-visible:ring-[#E4572E] rounded-[6px] transition-colors"
        >
          {showPassword ? (
            <EyeOff className="w-4 h-4 stroke-[1.5] shrink-0" aria-hidden="true" />
          ) : (
            <Eye className="w-4 h-4 stroke-[1.5] shrink-0" aria-hidden="true" />
          )}
        </button>
      </div>
    );
  }
);

PasswordInput.displayName = 'PasswordInput';

export default PasswordInput;
