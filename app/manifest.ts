import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RoleFit Studio",
    short_name: "RoleFit",
    description: "Local LaTeX resume studio and job-tailoring workspace.",
    start_url: "/",
    display: "standalone",
    background_color: "#F8F7F1",
    theme_color: "#1F513B",
    icons: [
      { src: "/rolefit-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/rolefit-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
