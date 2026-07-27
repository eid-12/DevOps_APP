package com.cloudbase.service;

import com.cloudbase.dto.AuthDtos.AuthResponse;
import com.cloudbase.dto.AuthDtos.LoginRequest;
import com.cloudbase.dto.AuthDtos.RegisterRequest;
import com.cloudbase.model.UserAccount;

public interface AuthService {
    AuthResponse login(LoginRequest request);

    AuthResponse register(RegisterRequest request);

    UserAccount resolveUser(String token);
}
