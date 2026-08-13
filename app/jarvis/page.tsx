import type { Metadata } from "next";
import { JarvisChat } from "./JarvisChat";

export const metadata: Metadata = {
  title: "JARVIS | JARVIS LAB",
  description: "Interfaz conversacional de JARVIS WEB LAB.",
};

export default function JarvisPage() {
  return <JarvisChat />;
}
