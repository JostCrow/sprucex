import { SpruceX } from "sprucex";
const factory = SpruceX.data("counter-cjs", (initial: number) => ({ count: initial }));
const count: number = factory(1).count;
SpruceX.store("cjs", { count });
