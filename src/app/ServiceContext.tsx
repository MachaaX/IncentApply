import { createContext, useContext } from "react";
import type { ServiceContainer } from "../services/contracts";
import { services } from "../services/mock/mockServices";

const ServiceContext = createContext<ServiceContainer>(services);

export function ServiceProvider({
  children,
  value
}: {
  children: React.ReactNode;
  value?: ServiceContainer;
}) {
  return (
    <ServiceContext.Provider value={value ?? services}>{children}</ServiceContext.Provider>
  );
}

export function useServices(): ServiceContainer {
  return useContext(ServiceContext);
}
