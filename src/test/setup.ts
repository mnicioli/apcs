import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Limpa o DOM montado após cada teste para evitar vazamento de estado entre eles.
afterEach(() => {
  cleanup();
});
