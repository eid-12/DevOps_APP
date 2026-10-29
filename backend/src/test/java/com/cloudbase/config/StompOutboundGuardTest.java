package com.cloudbase.config;

import com.cloudbase.entity.ProjectEntity;
import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.AccountStatus;
import com.cloudbase.model.UserRole;
import com.cloudbase.repository.ServiceRepository;
import com.cloudbase.repository.UserRepository;
import com.cloudbase.security.JwtService;
import io.jsonwebtoken.Claims;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;

import java.util.Date;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** The simple broker delivers with the subscriber's session id but without its user header. */
class StompOutboundGuardTest {

    private final JwtService jwt = mock(JwtService.class);
    private final UserRepository users = mock(UserRepository.class);
    private final ServiceRepository services = mock(ServiceRepository.class);
    private final StompAuthChannelInterceptor interceptor = new StompAuthChannelInterceptor(jwt, users, services);
    private final UserEntity owner = new UserEntity();

    StompOutboundGuardTest() {
        owner.setId("u1");
        owner.setRole(UserRole.USER);
        owner.setAccountStatus(AccountStatus.ACTIVE);
        owner.setEmailVerified(true);
        owner.setPasswordHash("hash-1");
        when(users.findById("u1")).thenReturn(Optional.of(owner));
        Claims claims = mock(Claims.class);
        when(claims.getSubject()).thenReturn("u1");
        when(jwt.isTokenValid("t")).thenReturn(true);
        when(jwt.parseToken("t")).thenReturn(claims);
        when(claims.getExpiration()).thenReturn(new Date(System.currentTimeMillis() + 3_600_000));
        when(jwt.isCurrentForPassword(claims, "hash-1")).thenReturn(true);
        when(services.findByIdWithProject("s1")).thenReturn(Optional.of(ServiceEntity.builder().id("s1")
                .project(ProjectEntity.builder().id("p").ownerId("u1").name("p").build()).build()));
    }

    private void stomp(StompCommand command) {
        StompHeaderAccessor a = StompHeaderAccessor.create(command);
        a.setSessionId("sess-1");
        a.setNativeHeader("Authorization", "Bearer t");
        a.setLeaveMutable(true); // as the inbound channel delivers it, so CONNECT can attach the user
        interceptor.preSend(MessageBuilder.createMessage(new byte[0], a.getMessageHeaders()), mock(MessageChannel.class));
    }

    /** Same headers SimpleBrokerMessageHandler sets: session and subscription id, destination, no user. */
    private static Message<?> brokerDelivery() {
        SimpMessageHeaderAccessor a = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
        a.setSessionId("sess-1");
        a.setSubscriptionId("sub-0");
        a.setDestination("/topic/deployments/s1");
        return MessageBuilder.createMessage(new byte[0], a.getMessageHeaders());
    }

    @Test
    void deliversToTheConnectedOwner() {
        stomp(StompCommand.CONNECT);
        Message<?> delivery = brokerDelivery();
        assertSame(delivery, interceptor.guardOutbound(delivery));
    }

    @Test
    void suspensionReplacesTheEventWithAnErrorThatClosesTheSession() {
        stomp(StompCommand.CONNECT);
        owner.setAccountStatus(AccountStatus.SUSPENDED);
        Message<?> out = interceptor.guardOutbound(brokerDelivery());
        assertEquals(StompCommand.ERROR, StompHeaderAccessor.wrap(out).getCommand());
        assertEquals(0, interceptor.connectedSessionCount());
    }

    @Test
    void forgetsTheSessionOnDisconnect() {
        stomp(StompCommand.CONNECT);
        assertEquals(1, interceptor.connectedSessionCount());
        stomp(StompCommand.DISCONNECT);
        assertEquals(0, interceptor.connectedSessionCount());
        assertEquals(StompCommand.ERROR, StompHeaderAccessor.wrap(interceptor.guardOutbound(brokerDelivery())).getCommand());
    }

    @Test
    void passwordChangeEndsTheOpenSession() {
        stomp(StompCommand.CONNECT);
        owner.setPasswordHash("hash-2");
        assertEquals(StompCommand.ERROR, StompHeaderAccessor.wrap(interceptor.guardOutbound(brokerDelivery())).getCommand());
    }
}
