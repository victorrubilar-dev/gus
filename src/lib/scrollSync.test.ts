import { describe, expect, it } from "vitest";
import { followScrollTop } from "./scrollSync";

describe("scroll de la vista dividida", () => {
  it("lleva al otro panel a la misma proporción", () => {
    expect(followScrollTop({ scrollTop: 50, scrollHeight: 200, clientHeight: 100 }, { scrollTop: 0, scrollHeight: 500, clientHeight: 100 })).toBe(200);
    expect(followScrollTop({ scrollTop: 100, scrollHeight: 200, clientHeight: 100 }, { scrollTop: 0, scrollHeight: 300, clientHeight: 100 })).toBe(200);
  });

  it("sin nada que desplazar se queda arriba", () => {
    expect(followScrollTop({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 }, { scrollTop: 40, scrollHeight: 500, clientHeight: 100 })).toBe(0);
    expect(followScrollTop({ scrollTop: 30, scrollHeight: 300, clientHeight: 100 }, { scrollTop: 0, scrollHeight: 80, clientHeight: 100 })).toBe(0);
  });
});
