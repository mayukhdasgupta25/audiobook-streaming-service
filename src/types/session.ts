// Session type extensions for Express
import 'express-session';

declare module 'express-session' {
   interface SessionData {
      userId?: string;
      userRole?: string;
      isAuthenticated?: boolean;
   }
}

export { };
