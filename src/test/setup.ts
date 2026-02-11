import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { resetState } from "../mocks/stateStore";

beforeEach(() => {
  resetState();
  window.history.replaceState({}, "", "/");
});
