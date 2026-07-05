"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-slate-100 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="w-full max-w-xs space-y-6 text-center"
      >
        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-white shadow-sm ring-1 ring-emerald-100 flex items-center justify-center">
            <Lock className="w-8 h-8 text-slate-500" />
          </div>
        </div>

        {/* Title */}
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold text-slate-700">
            Inspirations Farm
          </h2>
          <p className="text-sm text-slate-400">请输入农场密钥</p>
        </div>

        {/* Form */}
        <div className="space-y-3">
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
            className="h-11 text-center text-base tracking-widest border-slate-200 focus-visible:ring-emerald-500"
            autoFocus
          />

          {error && (
            <p className="text-sm text-red-500 animate-in fade-in">
              密钥错误
            </p>
          )}

          <Button
            onClick={handleSubmit}
            disabled={checking || !input.trim()}
            className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {checking ? "验证中..." : "进入农场"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
