import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "灵感农场 · Inspirations Farm",
    short_name: "农场",
    description: "把灵感种下，把今天过好。",
    start_url: "/",
    display: "standalone",
    background_color: "#f2efe4",
    theme_color: "#f2efe4",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
