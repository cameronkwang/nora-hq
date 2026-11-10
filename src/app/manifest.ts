import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nora HQ",
    short_name: "Nora HQ",
    start_url: "/asks/new",
    display: "standalone",
    background_color: "#f7f6f3",
    theme_color: "#c2410c",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
