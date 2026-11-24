// Run by a Job Queue entry (e.g. every 5 minutes).
// READ-ONLY on sales orders: finds released portal orders whose Order Reviewed = Reviewed, tells the portal once,
// and records that in its own log table. The portal checks the order with BC itself before emailing.
codeunit 99721 "JSHP Confirm Notifier"
{
    trigger OnRun()
    begin
        NotifyConfirmedOrders();
    end;

    var
        OrderReviewedFieldNo: Integer;

    procedure NotifyConfirmedOrders()
    var
        Setup: Record "JSHP Portal Setup";
        SalesHeader: Record "Sales Header";
        Log: Record "JSHP Portal Notification Log";
        PortalClient: Codeunit "JSHP Portal Client";
        Body: JsonObject;
        ResponseText: Text;
    begin
        if not Setup.Get() then
            exit;
        if not Setup."Send Confirmations" or (Setup."Portal URL" = '') or not PortalClient.HasKey() then
            exit;
        OrderReviewedFieldNo := 50031; // JSHealthXero "Order Reviewed", read by number (no dependency)

        SalesHeader.SetRange("Document Type", SalesHeader."Document Type"::Order);
        SalesHeader.SetRange(Status, SalesHeader.Status::Released);
        SalesHeader.SetFilter("External Document No.", 'JSH*');
        if Setup."Confirm From Date" <> 0D then
            SalesHeader.SetFilter("Order Date", '>=%1', Setup."Confirm From Date");
        if SalesHeader.FindSet() then
            repeat
                if not Log.Get(SalesHeader."No.") then
                    if IsReviewed(SalesHeader) then begin
                        Clear(Body);
                        Body.Add('orderNumber', SalesHeader."No.");
                        Body.Add('portalOrderNo', SalesHeader."External Document No.");
                        if PortalClient.Post('/api/notify/confirmed', Body, ResponseText) then begin
                            Log.Init();
                            Log."Order No." := SalesHeader."No.";
                            Log."Portal Order No." := SalesHeader."External Document No.";
                            Log."Notified At" := CurrentDateTime();
                            Log.Result := CopyStr(PortalClient.ReadMessage(ResponseText), 1, MaxStrLen(Log.Result));
                            Log.Insert();
                            Commit(); // keep progress even if a later order fails
                        end;
                    end;
            until SalesHeader.Next() = 0;
    end;

    local procedure IsReviewed(SalesHeader: Record "Sales Header"): Boolean
    var
        RecRef: RecordRef;
        FldRef: FieldRef;
    begin
        RecRef.GetTable(SalesHeader);
        if not RecRef.FieldExist(OrderReviewedFieldNo) then
            exit(false);
        FldRef := RecRef.Field(OrderReviewedFieldNo);
        exit(Format(FldRef.Value) = 'Reviewed');
    end;
}
