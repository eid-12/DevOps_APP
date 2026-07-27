import { Injectable, computed, inject, signal } from '@angular/core';
import { delay, Observable, of, throwError } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuthResponse, UserAccount } from './models';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly store = inject(MockStore);
  private readonly tokenState = signal<string>(localStorage.getItem('cloudbase.token') ?? '');
  private readonly userState = signal<UserAccount | null>(this.readStoredUser());

  readonly token = computed(() => this.tokenState());
  readonly user = computed(() => this.userState());
  readonly isAuthenticated = computed(() => !!this.tokenState());
  readonly isAdmin = computed(() => this.userState()?.role === 'ADMIN');

  login(payload: { email: string; password: string }): Observable<AuthResponse> {
    const user = this.store.findUserByEmail(payload.email);
    const password = this.store.getPassword(payload.email);

    if (!user || password !== payload.password) {
      return throwError(() => ({ error: { message: 'Invalid email or password' } })).pipe(delay(250));
    }

    const response: AuthResponse = {
      token: `mock-${user.id}`,
      user,
      message: 'Login successful'
    };

    return of(response).pipe(
      delay(250),
      tap((result) => this.persistSession(result))
    );
  }

  register(payload: { name: string; email: string; password: string }): Observable<AuthResponse> {
    if (this.store.findUserByEmail(payload.email)) {
      return throwError(() => ({ error: { message: 'Email already exists' } })).pipe(delay(250));
    }

    const user = this.store.addUser(payload.name, payload.email, payload.password);
    const response: AuthResponse = {
      token: `mock-${user.id}`,
      user,
      message: 'Registration successful'
    };

    return of(response).pipe(
      delay(250),
      tap((result) => this.persistSession(result))
    );
  }

  requireUser(): UserAccount {
    const user = this.userState();
    if (!user) {
      throw new Error('Not authenticated');
    }
    return user;
  }

  logout() {
    this.tokenState.set('');
    this.userState.set(null);
    localStorage.removeItem('cloudbase.token');
    localStorage.removeItem('cloudbase.user');
  }

  private persistSession(response: AuthResponse) {
    this.tokenState.set(response.token);
    this.userState.set(response.user);
    localStorage.setItem('cloudbase.token', response.token);
    localStorage.setItem('cloudbase.user', JSON.stringify(response.user));
  }

  private readStoredUser(): UserAccount | null {
    const raw = localStorage.getItem('cloudbase.user');
    return raw ? JSON.parse(raw) as UserAccount : null;
  }
}
