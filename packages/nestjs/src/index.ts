import { Inject, Module } from '@nestjs/common';
import type { DynamicModule, FactoryProvider, ModuleMetadata, Provider } from '@nestjs/common';
import { EmszmalClient } from '@toniekw/emszmal-client';
import type { ClientOptions } from '@toniekw/emszmal-client';

export { EmszmalClient } from '@toniekw/emszmal-client';
export type { ClientOptions } from '@toniekw/emszmal-client';

/** Stable across CommonJS/ESM imports. */
export const EMSZMAL_CLIENT = Symbol.for('nestjs-emszmal/client');
const EMSZMAL_OPTIONS = Symbol('nestjs-emszmal/options');

export interface EmszmalModuleOptions extends ClientOptions { isGlobal?: boolean }
export interface EmszmalModuleAsyncOptions {
  imports?: ModuleMetadata['imports'];
  inject?: FactoryProvider['inject'];
  useFactory: (...args: never[]) => ClientOptions | Promise<ClientOptions>;
  isGlobal?: boolean;
}

export function InjectEmszmalClient(): ReturnType<typeof Inject> { return Inject(EMSZMAL_CLIENT); }

export class EmszmalModule {
  static forRoot(options: EmszmalModuleOptions): DynamicModule {
    const { isGlobal = false, ...clientOptions } = options;
    return this.#module({ provide: EMSZMAL_OPTIONS, useValue: clientOptions }, isGlobal);
  }

  static forRootAsync(options: EmszmalModuleAsyncOptions): DynamicModule {
    return {
      ...this.#module({
        provide: EMSZMAL_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      }, options.isGlobal ?? false),
      imports: options.imports ?? [],
    };
  }

  static #module(optionsProvider: Provider, global: boolean): DynamicModule {
    return {
      module: EmszmalModule,
      global,
      providers: [
        optionsProvider,
        {
          provide: EMSZMAL_CLIENT,
          useFactory: (options: ClientOptions) => new EmszmalClient(options),
          inject: [EMSZMAL_OPTIONS],
        },
        { provide: EmszmalClient, useExisting: EMSZMAL_CLIENT },
      ],
      exports: [EMSZMAL_CLIENT, EmszmalClient],
    };
  }
}

Module({})(EmszmalModule);
