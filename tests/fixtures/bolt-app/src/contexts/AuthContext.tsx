import { createContext, useContext } from "react";

const Ctx = createContext({ user: null as null | { id: string }, signIn: (_c: unknown) => {} });
export const AuthProvider = Ctx.Provider;
export const useAuth = () => useContext(Ctx);
