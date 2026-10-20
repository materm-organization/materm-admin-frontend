"use client"

import * as React from "react"
import { cn } from "cn"
import { EyeIcon, EyeOffIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// Drop-in replacement for `<Input type="password">` with a built-in
// show/hide toggle — extracted because this exact
// `relative + pr-10 Input + absolute eye-toggle Button` block was
// independently hand-rolled in change-password-dialog.tsx (x3),
// form-dialog-reset-password.tsx (x2), and detail-dialog.tsx (x1) before
// this component existed. Forwards its ref/props like the base `Input`, so
// it slots into both a plain controlled `value`/`onChange` usage and a
// react-hook-form `<FormField render={({ field }) => <PasswordInput
// {...field} />}>` usage unchanged.
const PasswordInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input"> & {
    showPasswordLabel?: string
    hidePasswordLabel?: string
  }
>(({ className, disabled, showPasswordLabel, hidePasswordLabel, ...props }, ref) => {
  const [visible, setVisible] = React.useState(false)

  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        className={cn("pr-10", className)}
        disabled={disabled}
        ref={ref}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        tabIndex={-1}
        className="absolute top-0 right-0 hover:bg-transparent"
        disabled={disabled}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
        {showPasswordLabel || hidePasswordLabel ? (
          <span className="sr-only">{visible ? hidePasswordLabel : showPasswordLabel}</span>
        ) : null}
      </Button>
    </div>
  )
})
PasswordInput.displayName = "PasswordInput"

export { PasswordInput }
