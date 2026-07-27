import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ErrorBoundary } from "./error-boundary";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f3f0e6",
};

export const metadata: Metadata = {
  title: "灵感农场 · Inspirations Farm",
  description: "把灵感种下，把今天过好。",
  applicationName: "Inspirations Farm",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "农场",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      data-theme="auto"
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"&&t!=="auto")t="auto";var h=(new Date()).getHours();var d=t==="dark"||(t!=="light"&&(h>=18||h<6));document.documentElement.classList.toggle("dark",d);document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",d?"#101914":"#f3f0e6")}catch(e){}})()`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
        {process.env.NODE_ENV === "production" && (
          <script
            dangerouslySetInnerHTML={{
              __html: `
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js').then(
      function(reg) { console.log('SW registered:', reg.scope); },
      function(err) { console.log('SW failed:', err); }
    );
  });
}
              `.trim(),
            }}
          />
        )}
      </body>
    </html>
  );
}
