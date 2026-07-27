package com.cloudbase.service.impl;

import com.cloudbase.dto.AuthDtos.AuthResponse;
import com.cloudbase.dto.AuthDtos.LoginRequest;
import com.cloudbase.dto.AuthDtos.RegisterRequest;
import com.cloudbase.model.UserAccount;
import com.cloudbase.service.AuthService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AuthServiceImpl implements AuthService {

    private final InMemoryPlatformStore store;

    public AuthServiceImpl(InMemoryPlatformStore store) {
        this.store = store;
    }

    @Override
    public AuthResponse login(LoginRequest request) {
        UserAccount user = store.getUserByEmail(request.email());
        if (user == null || !request.password().equals(store.getPassword(request.email()))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password");
        }
        return new AuthResponse(store.issueToken(user), user, "Login successful");
    }

    @Override
    public AuthResponse register(RegisterRequest request) {
        if (store.getUserByEmail(request.email()) != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Email already exists");
        }
        UserAccount user = store.addUser(request.name(), request.email(), request.password());
        return new AuthResponse(store.issueToken(user), user, "Registration successful");
    }

    @Override
    public UserAccount resolveUser(String token) {
        UserAccount user = token == null ? null : store.getUserByToken(token);
        if (user == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Missing or invalid token");
        }
        return user;
    }
}
