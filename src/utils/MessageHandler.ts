/**
 * Message Handler Utility
 * Handles message retrieval with internationalization support
 */
import { Request } from 'express';
import {
   getSuccessMessage,
   getErrorMessage,
   getValidationMessage,
   getUnauthorizedMessage,
   getStreamingMessage,
   getMessage,
   MessageParams,
   MessageCatalog
} from '../i18n/messages';

/**
 * Message Handler class for retrieving localized messages
 */
export class MessageHandler {
   private static currentLocale: string = 'en';

   /**
    * Set the current locale for message retrieval
    */
   static setLocale(locale: string): void {
      this.currentLocale = locale;
   }

   /**
    * Get the current locale
    */
   static getLocale(): string {
      return this.currentLocale;
   }

   /**
    * Extract locale from request headers or query parameters
    */
   static extractLocaleFromRequest(req: Request): string {
      // Check Accept-Language header
      const acceptLanguage = req.headers['accept-language'];
      if (acceptLanguage) {
         const locale = acceptLanguage.split(',')[0].split('-')[0];
         if (this.isValidLocale(locale)) {
            return locale;
         }
      }

      // Check query parameter
      const queryLocale = req.query.locale as string;
      if (queryLocale && this.isValidLocale(queryLocale)) {
         return queryLocale;
      }

      // Default to English
      return 'en';
   }

   /**
    * Check if locale is valid
    */
   private static isValidLocale(locale: string): boolean {
      const supportedLocales = ['en']; // Add more locales as needed
      return supportedLocales.includes(locale);
   }

   /**
    * Get success message
    */
   static getSuccessMessage(key: string, params?: MessageParams, locale?: string): string {
      const targetLocale = locale || this.currentLocale;
      return getSuccessMessage(key, params, targetLocale);
   }

   /**
    * Get error message
    */
   static getErrorMessage(key: string, params?: MessageParams, locale?: string): string {
      const targetLocale = locale || this.currentLocale;
      return getErrorMessage(key, params, targetLocale);
   }

   /**
    * Get validation message
    */
   static getValidationMessage(key: string, params?: MessageParams, locale?: string): string {
      const targetLocale = locale || this.currentLocale;
      return getValidationMessage(key, params, targetLocale);
   }

   /**
    * Get unauthorized message
    */
   static getUnauthorizedMessage(key: string, params?: MessageParams, locale?: string): string {
      const targetLocale = locale || this.currentLocale;
      return getUnauthorizedMessage(key, params, targetLocale);
   }

   /**
    * Get streaming message
    */
   static getStreamingMessage(key: string, params?: MessageParams, locale?: string): string {
      const targetLocale = locale || this.currentLocale;
      return getStreamingMessage(key, params, targetLocale);
   }

   /**
    * Get generic message
    */
   static getMessage(
      category: keyof MessageCatalog,
      key: string,
      params?: MessageParams,
      locale?: string
   ): string {
      const targetLocale = locale || this.currentLocale;
      return getMessage(targetLocale, category, key, params);
   }

   /**
    * Get message with request context (extracts locale from request)
    */
   static getMessageFromRequest(
      req: Request,
      category: keyof MessageCatalog,
      key: string,
      params?: MessageParams
   ): string {
      const locale = this.extractLocaleFromRequest(req);
      return this.getMessage(category, key, params, locale);
   }

   /**
    * Get success message with request context
    */
   static getSuccessMessageFromRequest(
      req: Request,
      key: string,
      params?: MessageParams
   ): string {
      const locale = this.extractLocaleFromRequest(req);
      return this.getSuccessMessage(key, params, locale);
   }

   /**
    * Get error message with request context
    */
   static getErrorMessageFromRequest(
      req: Request,
      key: string,
      params?: MessageParams
   ): string {
      const locale = this.extractLocaleFromRequest(req);
      return this.getErrorMessage(key, params, locale);
   }

   /**
    * Get validation message with request context
    */
   static getValidationMessageFromRequest(
      req: Request,
      key: string,
      params?: MessageParams
   ): string {
      const locale = this.extractLocaleFromRequest(req);
      return this.getValidationMessage(key, params, locale);
   }

   /**
    * Get unauthorized message with request context
    */
   static getUnauthorizedMessageFromRequest(
      req: Request,
      key: string,
      params?: MessageParams
   ): string {
      const locale = this.extractLocaleFromRequest(req);
      return this.getUnauthorizedMessage(key, params, locale);
   }

   /**
    * Get streaming message with request context
    */
   static getStreamingMessageFromRequest(
      req: Request,
      key: string,
      params?: MessageParams
   ): string {
      const locale = this.extractLocaleFromRequest(req);
      return this.getStreamingMessage(key, params, locale);
   }

   /**
    * Format message with multiple parameters
    */
   static formatMessage(
      template: string,
      params: MessageParams
   ): string {
      let message = template;

      Object.entries(params).forEach(([key, value]) => {
         const placeholder = new RegExp(`{{${key}}}`, 'g');
         message = message.replace(placeholder, String(value));
      });

      return message;
   }

   /**
    * Get message with fallback
    */
   static getMessageWithFallback(
      category: keyof MessageCatalog,
      key: string,
      fallback: string,
      params?: MessageParams,
      locale?: string
   ): string {
      try {
         return this.getMessage(category, key, params, locale);
      } catch (error) {
         console.warn(`Failed to get message ${category}.${key}:`, error);
         return this.formatMessage(fallback, params || {});
      }
   }
}
