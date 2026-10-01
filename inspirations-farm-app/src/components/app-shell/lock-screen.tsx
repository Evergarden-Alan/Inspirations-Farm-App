"use client";

import { useState } from "react";
import { Lock, Sprout } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setPin as savePin, apiFetch } from "@/lib/api";

interface Props {
  onUnlock: () => void;
}

export function LockScreen({ onUnlock }: Props) {
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  async function handleSubmit() {
    if (!input.trim() || checking) return;

    setChecking(true);
    setError(false);

    // Save PIN so apiFetch can attach it to requests
    savePin(input.trim());

    try {
      const res = await apiFetch("/api/github");
      if (res.ok) {
        onUnlock();
      } else {
        // Wrong PIN
        setInput("");
        setError(true);
      }
    } catch {
      setInput("");
      setError(true);
    } finally {
      setChecking(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="farm-lock min-h-screen p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="relative w-full max-w-sm overflow-hidden rounded-[2rem_2rem_0.75rem_2rem] border border-[var(--farm-line)] bg-[var(--farm-paper)]/95 p-8 text-center shadow-[0_30px_80px_rgb(38_56_46_/_18%)] sm:p-10"
      >
        <div className="absolute right-5 top-5 text-[var(--farm-green)]/30" aria-hidden="true">
          <Lock className="size-4" strokeWidth={1.6} />
        </div>

        {/* Icon */}
        <div className="flex justify-center">
          <div className="farm-brand-mark h-16 w-16">
            <Sprout className="h-7 w-7 text-[var(--farm-green)]" strokeWidth={1.7} />
          </div>
        </div>

        {/* Title */}
        <div className="mt-6 space-y-2">
          <p className="farm-kicker">PRIVATE GARDEN</p>
          <h2 className="farm-display text-3xl font-semibold text-[var(--farm-ink)]">欢迎回到农场</h2>
          <p className="text-sm text-[var(--farm-muted)]">输入密钥，继续照看你的灵感。</p>
        </div>

        {/* Form */}
        <div className="mt-7 space-y-3">
          <Input
            type="password"
            placeholder="农场密钥"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(false);
            }}
            onKeyDown={handleKeyDown}
            disabled={checking}
            className="farm-input h-12 rounded-xl text-center text-base tracking-[0.3em]"
            autoFocus
          />

          {error && (
            <p className="farm-alert-error animate-in fade-in px-3 py-2 text-sm" role="alert">
              密钥错误
            </p>
          )}

          <Button
            onClick={handleSubmit}
            disabled={checking || !input.trim()}
            className="farm-primary-button h-12 w-full"
          >
            {checking ? "验证中..." : "进入农场"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
