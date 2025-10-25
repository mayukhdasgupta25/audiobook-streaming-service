// Session type extensions for Express
declare global {
   namespace Express {
      interface Session {
         userId?: string;
         userRole?: string;
         isAuthenticated?: boolean;
      }
   }
}

export { };
